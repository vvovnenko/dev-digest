import type { FindingActionKind, RunEventKind, RunTrace } from '@devdigest/shared';
import { AppError, NotFoundError, ValidationError } from '../../platform/errors.js';
import type { ReviewAgent } from './domain.js';
import type { ReviewDeps } from './ports.js';
import { type ReviewDto, type ReviewDtoFinding } from './helpers.js';
import { ReviewRunExecutor, type Logger } from './run-executor.js';
import { actOnFinding as actOnFindingImpl } from './findings.js';
import { reviewToDto } from './helpers.js';

// Re-export DTO types + converters for backward-compatible imports from
// './service.js' (these previously lived here; logic now in ./helpers.ts).
export { findingRowToDto, reviewToDto } from './helpers.js';
export type { ReviewDto, ReviewDtoFinding } from './helpers.js';

/**
 * Review service (the core). Orchestrates:
 *   diff → assemblePrompt(system + repo-map + diff)
 *        → llm.completeStructured({ schema: Review }) (single-pass)
 *        → groundFindings(...) (citation gate — drops findings off the diff)
 *        → persist reviews + kept findings (+ grounding summary)
 *   while streaming RunEvents over the run bus, and on completion writing
 *   the whole log as ONE RunTrace doc + an agent_runs row.
 *
 * Also: the finding accept/dismiss actions. The bulky run execution lives in
 * run-executor; this class keeps the public method surface.
 */
export class ReviewService {
  private executor: ReviewRunExecutor;

  constructor(private deps: ReviewDeps) {
    this.executor = new ReviewRunExecutor(deps);
  }

  // ===========================================================================
  // Run a review for one or all enabled agents on a PR.
  // ===========================================================================

  /**
   * Resolve which agents to run. `all` → all enabled agents; else a single agent.
   */
  async resolveTargets(
    workspaceId: string,
    opts: { agentId?: string; all?: boolean },
  ): Promise<ReviewAgent[]> {
    if (opts.all) return this.deps.agents.listEnabled(workspaceId);
    if (opts.agentId) {
      const agent = await this.deps.agents.getById(workspaceId, opts.agentId);
      if (!agent) throw new NotFoundError('Agent not found');
      return [agent];
    }
    throw new ValidationError('Provide agentId or all:true');
  }

  /** Delete a whole review run (one agent's pass) + its findings (cascade). */
  async deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return this.deps.store.deleteReview(workspaceId, reviewId);
  }

  /** In-flight runs for a PR (server-side source of truth, survives reload). */
  async activeRuns(workspaceId: string, prId: string) {
    return this.deps.store.activeRunsForPull(workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the run history (incl. failures). */
  async listRuns(workspaceId: string, prId: string, page: { limit: number; offset: number }) {
    return this.deps.store.listRunsForPull(workspaceId, prId, page);
  }

  /** Delete one run from the history (+ its trace). */
  async deleteRun(workspaceId: string, runId: string): Promise<boolean> {
    return this.deps.store.deleteAgentRun(workspaceId, runId);
  }

  /**
   * Cancel an in-flight run. Aborts a live runner's current LLM call and flags
   * it (it re-checks before every call and before saving), and marks the DB row
   * cancelled — the final write of a live run is guarded by that status, so a
   * cancel can't be overwritten by `done`. A live runner completes the bus when
   * it has recorded the cancel; a run still queued behind other agents, or an
   * ORPHANED one (its process died on a restart), has no runner working on it,
   * so the bus is completed here (the executor skips a queued one later).
   */
  async cancelRun(workspaceId: string, runId: string): Promise<void> {
    if (!(await this.deps.store.getRunStatus(workspaceId, runId))) throw new NotFoundError('Run not found');
    this.publish(runId, 'info', 'Cancellation requested — stopping…');
    this.deps.runs.cancel(runId);
    await this.deps.store.cancelRunIfRunning(workspaceId, runId);
    if (!this.deps.runs.isLive(runId)) this.deps.runs.complete(runId);
  }

  /**
   * Run a review for each target agent. Each agent gets its own runId
   * (= agent_runs.id) created up-front so the SSE route can be subscribed
   * before/while the run progresses. A partial failure in one agent does not
   * abort the others.
   */
  async runReview(
    workspaceId: string,
    prId: string,
    targets: ReviewAgent[],
    logger?: Logger,
  ): Promise<{ runs: { run_id: string; agent_id: string; agent_name: string }[]; reviews: ReviewDto[] }> {
    const pull = await this.deps.store.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.deps.store.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    // Create the agent_run rows up front so a runId is available IMMEDIATELY —
    // the client persists these in global state and subscribes to the SSE
    // stream. The actual (slow) review runs in the background below.
    const runIds = await this.deps.store.createAgentRuns(
      targets.map((agent) => ({
        workspaceId,
        agentId: agent.id,
        prId,
        provider: agent.provider,
        model: agent.model,
      })),
    );
    if (!runIds) {
      throw new AppError(
        'run_in_progress',
        'A review by this agent is already running on this pull request — wait for it or cancel it',
        409,
      );
    }
    const runs = targets.map((agent, i) => ({ run_id: runIds[i]!, agent_id: agent.id, agent_name: agent.name }));
    const jobs = targets.map((agent, i) => ({ agent, runId: runIds[i]! }));

    // Claimed before they wait: a shutdown then waits for (and fails) queued runs
    // too, and a cancel reaches a run that hasn't started.
    this.deps.runs.claim(runIds);
    const { queue } = this.deps;
    if (queue.pending >= queue.concurrency) {
      const msg = `Waiting for a free review slot — ${queue.concurrency} review request(s) run at a time`;
      for (const runId of runIds) this.publish(runId, 'info', msg);
    }

    // Fire-and-forget: the HTTP response returns now with the runIds; reviews
    // are persisted as each agent finishes and the client refetches on SSE done.
    void queue.add(() => this.executor.executeRuns(workspaceId, pull, repo, jobs, logger)).catch((err: unknown) => {
      logger?.error({ prId, err: (err as Error).message }, 'review: background execution crashed');
    });

    return { runs, reviews: [] };
  }

  private publish(runId: string, kind: RunEventKind, msg: string, data?: unknown) {
    return this.deps.runs.publish(runId, kind, msg, data);
  }

  // ===========================================================================
  // Finding actions
  // ===========================================================================

  async actOnFinding(
    workspaceId: string,
    findingId: string,
    action: FindingActionKind,
  ): Promise<{ finding: ReviewDtoFinding }> {
    return actOnFindingImpl(this.deps.store, workspaceId, findingId, action);
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  async reviewsForPull(workspaceId: string, prId: string, page: { limit: number; offset: number }): Promise<ReviewDto[]> {
    const pull = await this.deps.store.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const rows = await this.deps.store.reviewsForPull(prId, page);
    return rows.map(({ review, findings, usage, agentName }) => reviewToDto(review, findings, agentName, usage));
  }

  /** A run's status in the DB (undefined: the workspace has no such run). */
  async runStatus(workspaceId: string, runId: string): Promise<string | undefined> {
    return this.deps.store.getRunStatus(workspaceId, runId);
  }

  async getRunTrace(workspaceId: string, runId: string): Promise<RunTrace | undefined> {
    return this.deps.store.getRunTrace(workspaceId, runId);
  }
}
