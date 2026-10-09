import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { RunSummary, RunTrace } from '@devdigest/shared';

/**
 * A2 — review data-access. The ONLY layer touching the DB for the review
 * domain. Owns `reviews`, `findings`, `pr_intent`, and persists the
 * observability rows `agent_runs` + `run_traces` (one trace doc per run).
 * Workspace scoping is enforced via the PR (which carries workspace_id).
 *
 * The query implementations are colocated, split by aggregate, under
 * `./repository/` (review+findings, agent runs, pull/intent). This class
 * composes them so its public API stays identical.
 */

import type { FindingRow, PullRow } from '../../db/rows.js';
export type { FindingRow, PullRow };

export type ReviewRow = typeof t.reviews.$inferSelect;

import * as reviewRepo from './repository/review.repo.js';
import type { RunUsage } from './repository/review.repo.js';
import * as runRepo from './repository/run.repo.js';
import * as pullRepo from './repository/pull.repo.js';
import type { ReviewStore } from './ports.js';
import type { RunFailure } from './domain.js';
export type { RunUsage };

export class ReviewRepository implements ReviewStore {
  constructor(private db: Db) {}

  // ---- PR lookup (workspace-scoped) --------------------------------------

  getPull(workspaceId: string, prId: string): Promise<PullRow | undefined> {
    return pullRepo.getPull(this.db, workspaceId, prId);
  }

  getRepo(repoId: string): Promise<typeof t.repos.$inferSelect | undefined> {
    return pullRepo.getRepo(this.db, repoId);
  }

  getPrFiles(prId: string): Promise<(typeof t.prFiles.$inferSelect)[]> {
    return pullRepo.getPrFiles(this.db, prId);
  }

  // ---- reviews + findings -------------------------------------------------

  /** Reviews for a PR (newest first), each with its findings and its run's usage. */
  reviewsForPull(
    prId: string,
    page: { limit: number; offset: number },
  ): Promise<{ review: ReviewRow; findings: FindingRow[]; usage: RunUsage; agentName: string | null }[]> {
    return reviewRepo.reviewsForPull(this.db, prId, page);
  }

  getReview(reviewId: string): Promise<ReviewRow | undefined> {
    return reviewRepo.getReview(this.db, reviewId);
  }

  /** In-flight runs for a PR (status='running') — the server-side source of
   *  truth for "which agents are running now". Joined with the agent name. */
  activeRunsForPull(
    workspaceId: string,
    prId: string,
  ): Promise<{ run_id: string; agent_id: string | null; agent_name: string | null; ran_at: string | null }[]> {
    return runRepo.activeRunsForPull(this.db, workspaceId, prId);
  }

  /** All runs for a PR (any status), newest first — the PR run history. */
  listRunsForPull(workspaceId: string, prId: string, page: { limit: number; offset: number }): Promise<RunSummary[]> {
    return runRepo.listRunsForPull(this.db, workspaceId, prId, page);
  }

  /** Delete one agent run (+ its trace via FK cascade). Workspace-scoped. */
  deleteAgentRun(workspaceId: string, runId: string): Promise<boolean> {
    return runRepo.deleteAgentRun(this.db, workspaceId, runId);
  }

  /** Mark a still-running run as cancelled (no-op if it already finished). */
  cancelRunIfRunning(workspaceId: string, runId: string): Promise<boolean> {
    return runRepo.cancelRunIfRunning(this.db, workspaceId, runId);
  }

  /** On boot: any run still 'running' is orphaned (its process died / restarted),
   *  so mark it failed. Prevents permanently stuck "running" runs in the UI. */
  reapStaleRunningRuns(): Promise<number> {
    return runRepo.reapStaleRunningRuns(this.db);
  }

  /** Trace retention: drop the traces of finished runs started before `before`. */
  pruneRunTraces(before: Date): Promise<number> {
    return runRepo.pruneRunTraces(this.db, before);
  }

  /** Delete a whole review (one agent's run) + its findings (cascade), scoped
   *  to the workspace. Returns false if not found in the workspace. */
  deleteReview(workspaceId: string, reviewId: string): Promise<boolean> {
    return reviewRepo.deleteReview(this.db, workspaceId, reviewId);
  }

  // ---- finding actions ----------------------------------------------------

  getFinding(findingId: string): Promise<FindingRow | undefined> {
    return reviewRepo.getFinding(this.db, findingId);
  }

  /** Resolve workspace_id + pr_id for a finding (via review → pr). */
  findingContext(
    findingId: string,
  ): Promise<{ finding: FindingRow; review: ReviewRow; pull: PullRow } | undefined> {
    return reviewRepo.findingContext(this.db, findingId);
  }

  setFindingAccepted(findingId: string, at: Date | null): Promise<FindingRow | undefined> {
    return reviewRepo.setFindingAccepted(this.db, findingId, at);
  }

  setFindingDismissed(findingId: string, at: Date | null): Promise<FindingRow | undefined> {
    return reviewRepo.setFindingDismissed(this.db, findingId, at);
  }

  // ---- observability: agent_runs + run_traces ----------------------------

  /** Create one `running` row per agent, all or none; null when one of them is already running on the PR. */
  createAgentRuns(rows: Parameters<typeof runRepo.createAgentRuns>[1]): Promise<string[] | null> {
    return runRepo.createAgentRuns(this.db, rows);
  }

  /** Create an agent_runs row in `running` state; returns its id (= the runId). */
  createAgentRun(values: {
    workspaceId: string;
    agentId: string | null;
    prId: string;
    provider: string | null;
    model: string | null;
  }): Promise<string> {
    return runRepo.createAgentRun(this.db, values);
  }

  /**
   * Finish a run that produced a review, atomically (run row, review, findings,
   * reviewed sha, trace). Null when the run was cancelled, reaped or deleted
   * meanwhile — then nothing was written.
   */
  completeRunWithReview(
    runId: string,
    input: Parameters<typeof runRepo.completeRunWithReview>[2],
  ): Promise<{ review: ReviewRow; findings: FindingRow[] } | null> {
    return runRepo.completeRunWithReview(this.db, runId, input);
  }

  /** Record a failed or cancelled run and its trace, atomically; false when it already finished or is gone. */
  finishRunUnsuccessfully(runId: string, outcome: RunFailure, trace: RunTrace): Promise<boolean> {
    return runRepo.finishRunUnsuccessfully(this.db, runId, outcome, trace);
  }

  getRunStatus(workspaceId: string, runId: string): Promise<string | undefined> {
    return runRepo.getRunStatus(this.db, workspaceId, runId);
  }

  getRunTrace(workspaceId: string, runId: string): Promise<RunTrace | undefined> {
    return runRepo.getRunTrace(this.db, workspaceId, runId);
  }
}
