import type {
  Finding,
  LLMProvider,
  Provider,
  RunEvent,
  RunEventKind,
  RunSummary,
  RunTrace,
  UnifiedDiff,
} from '@devdigest/shared';
import type {
  FindingRecord,
  NewAgentRun,
  NewReview,
  ReviewAgent,
  ReviewPull,
  ReviewRecord,
  ReviewRepoRef,
  ReviewSkill,
  RunCompletion,
  RunFailure,
  RunUsage,
} from './domain.js';

/** Reviews, findings and runs (the ReviewRepository). */
export interface ReviewStore {
  getPull(workspaceId: string, prId: string): Promise<ReviewPull | undefined>;
  getRepo(repoId: string): Promise<ReviewRepoRef | undefined>;
  /** Newest first, one page; `agentName` joined in. */
  reviewsForPull(
    prId: string,
    page: { limit: number; offset: number },
  ): Promise<{ review: ReviewRecord; findings: FindingRecord[]; usage: RunUsage; agentName: string | null }[]>;
  deleteReview(workspaceId: string, reviewId: string): Promise<boolean>;
  findingContext(
    findingId: string,
  ): Promise<{ finding: FindingRecord; review: ReviewRecord; pull: ReviewPull } | undefined>;
  setFindingAccepted(findingId: string, at: Date | null): Promise<FindingRecord | undefined>;
  setFindingDismissed(findingId: string, at: Date | null): Promise<FindingRecord | undefined>;

  activeRunsForPull(
    workspaceId: string,
    prId: string,
  ): Promise<{ run_id: string; agent_id: string | null; agent_name: string | null; ran_at: string | null }[]>;
  /** Newest first, one page. */
  listRunsForPull(workspaceId: string, prId: string, page: { limit: number; offset: number }): Promise<RunSummary[]>;
  /** Create one `running` row per agent, all or none; null when one is already running on the PR. */
  createAgentRuns(rows: NewAgentRun[]): Promise<string[] | null>;
  /** Run row + review + findings + reviewed sha + trace, atomically; null when the run is no longer running. */
  completeRunWithReview(
    runId: string,
    input: { run: RunCompletion; review: NewReview; findings: Finding[]; reviewedSha: string; trace: RunTrace },
  ): Promise<{ review: ReviewRecord; findings: FindingRecord[] } | null>;
  /** Record a failed or cancelled run and its trace, atomically; false when it already finished or is gone. */
  finishRunUnsuccessfully(runId: string, outcome: RunFailure, trace: RunTrace): Promise<boolean>;
  cancelRunIfRunning(workspaceId: string, runId: string): Promise<boolean>;
  deleteAgentRun(workspaceId: string, runId: string): Promise<boolean>;
  reapStaleRunningRuns(): Promise<number>;
  getRunStatus(workspaceId: string, runId: string): Promise<string | undefined>;
  getRunTrace(workspaceId: string, runId: string): Promise<RunTrace | undefined>;
}

/** The agents a review can run (the agents repository). */
export interface AgentLookup {
  listEnabled(workspaceId: string): Promise<ReviewAgent[]>;
  getById(workspaceId: string, id: string): Promise<ReviewAgent | undefined>;
  /** The skills the agent's prompt includes: enabled links to enabled skills, in link order. */
  enabledSkills(workspaceId: string, agentId: string): Promise<ReviewSkill[]>;
}

/** Why a run was told to stop. */
export type RunStopReason = 'cancelled' | 'shutdown';

/** The live run bus (per app): events, cancellation and liveness of runs in this process. */
export interface RunEvents {
  publish(runId: string, kind: RunEventKind, msg: string, data?: unknown): RunEvent;
  buffer(runId: string): RunEvent[];
  claim(runIds: string[]): void;
  track(runId: string): AbortSignal;
  stopReason(runId: string): RunStopReason | undefined;
  isLive(runId: string): boolean;
  cancel(runId: string): void;
  complete(runId: string): void;
}

/** The diff a run reviews: `git diff base...head` when the clone has it, else the stored patches. */
export interface DiffSource {
  forPull(pull: ReviewPull, repo: ReviewRepoRef): Promise<UnifiedDiff>;
}

/** Repo-intel context for the prompt (the repo-intel facade); every call may fail or degrade. */
export interface RepoContext {
  getCallerSignatures(
    repoId: string,
    files: string[],
    limit: number,
  ): Promise<{ file: string; symbol: string; signature: string }[]>;
  getRepoMap(repoId: string): Promise<{ degraded?: boolean; text: string; tokens: number; cached: boolean }>;
  getFileRank(repoId: string, files: string[]): Promise<{ percentile: number }[]>;
}

/**
 * Where review requests wait their turn (a p-queue in the container): `add`
 * settles when the task has run; `pending` are running, `size` are waiting.
 */
export interface ReviewQueue {
  add(task: () => Promise<void>): Promise<void>;
  readonly pending: number;
  readonly size: number;
  readonly concurrency: number;
}

export interface ReviewDeps {
  store: ReviewStore;
  queue: ReviewQueue;
  agents: AgentLookup;
  runs: RunEvents;
  diffs: DiffSource;
  repoContext: RepoContext;
  /** Resolves a provider's client; throws when its key isn't configured. */
  llm: (provider: Provider) => Promise<LLMProvider>;
}
