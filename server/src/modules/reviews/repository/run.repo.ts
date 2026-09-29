import { and, desc, eq, inArray, lt, ne } from 'drizzle-orm';
import type { Db, DbExecutor } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { Finding, RunSummary, RunTrace } from '@devdigest/shared';
import type { FindingRow } from '../../../db/rows.js';
import { insertFindings, insertReview, type ReviewRow } from './review.repo.js';
import { markReviewed } from './pull.repo.js';
import type { NewReview, RunCompletion, RunFailure } from '../domain.js';

export type { RunCompletion };

// ---- in-flight / history --------------------------------------------------

/** In-flight runs for a PR (status='running') — the server-side source of
 *  truth for "which agents are running now". Joined with the agent name. */
export async function activeRunsForPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<{ run_id: string; agent_id: string | null; agent_name: string | null; ran_at: string | null }[]> {
  const rows = await db
    .select({
      id: t.agentRuns.id,
      agentId: t.agentRuns.agentId,
      ranAt: t.agentRuns.ranAt,
      agentName: t.agents.name,
    })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(
      and(
        eq(t.agentRuns.workspaceId, workspaceId),
        eq(t.agentRuns.prId, prId),
        eq(t.agentRuns.status, 'running'),
      ),
    );
  return rows.map((r) => ({
    run_id: r.id,
    agent_id: r.agentId,
    agent_name: r.agentName ?? null,
    ran_at: r.ranAt ? r.ranAt.toISOString() : null,
  }));
}

/** All runs for a PR (any status), newest first — the PR run history. */
export async function listRunsForPull(
  db: Db,
  workspaceId: string,
  prId: string,
  page: { limit: number; offset: number },
): Promise<RunSummary[]> {
  const rows = await db
    .select({ run: t.agentRuns, agentName: t.agents.name })
    .from(t.agentRuns)
    .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
    .where(and(eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.prId, prId)))
    .orderBy(desc(t.agentRuns.ranAt), desc(t.agentRuns.id))
    .limit(page.limit)
    .offset(page.offset);
  return rows.map(({ run, agentName }) => ({
    run_id: run.id,
    agent_id: run.agentId,
    agent_name: agentName ?? null,
    provider: run.provider,
    model: run.model,
    status: run.status,
    error: run.error,
    duration_ms: run.durationMs,
    tokens_in: run.tokensIn,
    tokens_out: run.tokensOut,
    cost_usd: run.costUsd,
    findings_count: run.findingsCount,
    grounding: run.grounding,
    ran_at: run.ranAt ? run.ranAt.toISOString() : null,
    score: run.score,
    blockers: run.blockers,
  }));
}

/**
 * Delete one agent run AND the review it produced, in one transaction.
 * Workspace-scoped. The trace and (since migration 0012) the review cascade from
 * `agent_runs`, and the findings from `reviews`; the review delete below makes
 * that step explicit, so a run removed from the timeline never leaves its
 * findings in the Review Runs list below.
 */
export async function deleteAgentRun(
  db: Db,
  workspaceId: string,
  runId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx
      .delete(t.reviews)
      .where(and(eq(t.reviews.runId, runId), eq(t.reviews.workspaceId, workspaceId)));
    const rows = await tx
      .delete(t.agentRuns)
      .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.workspaceId, workspaceId)))
      .returning({ id: t.agentRuns.id });
    return rows.length > 0;
  });
}

/** Mark a still-running run as cancelled (no-op if it already finished). Workspace-scoped. */
export async function cancelRunIfRunning(db: Db, workspaceId: string, runId: string): Promise<boolean> {
  const rows = await db
    .update(t.agentRuns)
    .set({ status: 'cancelled' })
    .where(
      and(eq(t.agentRuns.id, runId), eq(t.agentRuns.workspaceId, workspaceId), eq(t.agentRuns.status, 'running')),
    )
    .returning({ id: t.agentRuns.id });
  return rows.length > 0;
}

/** On boot: any run still 'running' is orphaned (its process died / restarted),
 *  so mark it failed. Prevents permanently stuck "running" runs in the UI. */
export async function reapStaleRunningRuns(db: Db): Promise<number> {
  const rows = await db
    .update(t.agentRuns)
    .set({ status: 'failed', error: 'The API restarted while this run was in progress' })
    .where(eq(t.agentRuns.status, 'running'))
    .returning({ id: t.agentRuns.id });
  return rows.length;
}

/**
 * Trace retention: delete the traces of finished runs that started before
 * `before`. The run rows stay (history, cost); only the bulky trace goes.
 */
export async function pruneRunTraces(db: Db, before: Date): Promise<number> {
  const old = db
    .select({ id: t.agentRuns.id })
    .from(t.agentRuns)
    .where(and(ne(t.agentRuns.status, 'running'), lt(t.agentRuns.ranAt, before)));
  const rows = await db
    .delete(t.runTraces)
    .where(inArray(t.runTraces.runId, old))
    .returning({ runId: t.runTraces.runId });
  return rows.length;
}

// ---- observability: agent_runs + run_traces -------------------------------

/**
 * Postgres unique violation on `constraint` (postgres-js surfaces code + constraint_name).
 * Drizzle ≥ 0.44 wraps the driver's error in `DrizzleQueryError`, so walk the `cause` chain.
 */
function isUniqueViolation(err: unknown, constraint: string): boolean {
  let e: unknown = err;
  for (let depth = 0; e && depth < 5; depth++, e = (e as { cause?: unknown }).cause) {
    const pg = e as { code?: string; constraint_name?: string };
    if (pg.code === '23505' && pg.constraint_name === constraint) return true;
  }
  return false;
}

/**
 * Create one `running` row per agent, all or none. Null when an agent already
 * has a live run on the PR (agent_runs_one_running_uq) — a double click or a
 * script must not start (and pay for) the same review twice.
 */
export async function createAgentRuns(
  db: Db,
  rows: Parameters<typeof createAgentRun>[1][],
): Promise<string[] | null> {
  try {
    return await db.transaction(async (tx) => {
      const ids: string[] = [];
      for (const values of rows) ids.push(await createAgentRun(tx, values));
      return ids;
    });
  } catch (err) {
    if (isUniqueViolation(err, 'agent_runs_one_running_uq')) return null;
    throw err;
  }
}

/** Create an agent_runs row in `running` state; returns its id (= the runId). */
export async function createAgentRun(
  db: DbExecutor,
  values: {
    workspaceId: string;
    agentId: string | null;
    prId: string;
    provider: string | null;
    model: string | null;
  },
): Promise<string> {
  const [row] = await db
    .insert(t.agentRuns)
    .values({
      workspaceId: values.workspaceId,
      agentId: values.agentId,
      prId: values.prId,
      provider: values.provider,
      model: values.model,
      status: 'running',
      source: 'local',
    })
    .returning({ id: t.agentRuns.id });
  return row!.id;
}

/**
 * Finish a run that produced a review — atomically: the run row, its review and
 * findings, the PR's reviewed sha and the trace commit together or not at all.
 * Guarded by `status = 'running'`: when the run was cancelled, reaped or deleted
 * in the meantime nothing is written and null comes back (the cancel wins).
 */
export async function completeRunWithReview(
  db: Db,
  runId: string,
  input: {
    run: RunCompletion;
    review: NewReview;
    findings: Finding[];
    reviewedSha: string;
    trace: RunTrace;
  },
): Promise<{ review: ReviewRow; findings: FindingRow[] } | null> {
  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(t.agentRuns)
      .set({ status: 'done', ...input.run, error: null })
      .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.status, 'running')))
      .returning({ id: t.agentRuns.id });
    if (claimed.length === 0) return null;
    const review = await insertReview(tx, { ...input.review, runId });
    const findings = await insertFindings(tx, review.id, input.findings);
    await markReviewed(tx, input.review.prId, input.reviewedSha);
    await saveRunTrace(tx, runId, input.trace);
    return { review, findings };
  });
}

/**
 * Record a failed or cancelled run and its trace (the log so far), atomically.
 * A failure is written only while the run is still `running`; a cancel also
 * completes a row the user already marked `cancelled`, adding duration, usage
 * and the log. Returns false when the run is gone or already finished.
 */
export async function finishRunUnsuccessfully(
  db: Db,
  runId: string,
  outcome: RunFailure,
  trace: RunTrace,
): Promise<boolean> {
  const from = outcome.status === 'cancelled' ? ['running', 'cancelled'] : ['running'];
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(t.agentRuns)
      .set({ ...outcome, findingsCount: 0, grounding: '0/0 passed', score: null, blockers: null })
      .where(and(eq(t.agentRuns.id, runId), inArray(t.agentRuns.status, from)))
      .returning({ id: t.agentRuns.id });
    if (rows.length === 0) return false;
    await saveRunTrace(tx, runId, trace);
    return true;
  });
}

/** Persist the WHOLE run log as ONE document. PK = runId → agent_runs. */
export async function saveRunTrace(db: DbExecutor, runId: string, trace: RunTrace): Promise<void> {
  await db
    .insert(t.runTraces)
    .values({ runId, trace })
    .onConflictDoUpdate({ target: t.runTraces.runId, set: { trace } });
}

/** A run's status, or undefined when the workspace has no such run. */
export async function getRunStatus(db: Db, workspaceId: string, runId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ status: t.agentRuns.status })
    .from(t.agentRuns)
    .where(and(eq(t.agentRuns.id, runId), eq(t.agentRuns.workspaceId, workspaceId)));
  return row?.status;
}

/** A run's trace, when the run is in the workspace. */
export async function getRunTrace(db: Db, workspaceId: string, runId: string): Promise<RunTrace | undefined> {
  const [row] = await db
    .select({ trace: t.runTraces.trace })
    .from(t.runTraces)
    .innerJoin(t.agentRuns, eq(t.agentRuns.id, t.runTraces.runId))
    .where(and(eq(t.runTraces.runId, runId), eq(t.agentRuns.workspaceId, workspaceId)));
  return row ? (row.trace as RunTrace) : undefined;
}
