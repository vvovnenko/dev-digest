import type {
  FeatureModelChoice,
  GitHubClient,
  LLMProvider,
  PrDetail,
  Provider,
  UnifiedDiff,
} from '@devdigest/shared';
import type {
  IntentFailure,
  IntentPull,
  IntentRecord,
  IntentRepoRef,
  IntentResult,
  NewIntentAttempt,
} from './domain.js';

/** The intent repository: one row per PR. Every method but the boot reaper is scoped to the workspace. */
export interface IntentStore {
  get(workspaceId: string, prId: string): Promise<IntentRecord | undefined>;
  /**
   * A new `queued` attempt on the PR's row (created if missing), keeping the last result.
   * Undefined when an attempt is already active — a concurrent request won; nothing changes.
   */
  claim(attempt: NewIntentAttempt): Promise<IntentRecord | undefined>;
  /** Records the job that runs the attempt. */
  setJobId(workspaceId: string, prId: string, jobId: string): Promise<void>;
  /** An active attempt → `running`; undefined when there is none (the row is gone or the attempt finished). */
  markRunning(workspaceId: string, prId: string): Promise<IntentRecord | undefined>;
  /** Stores the result and marks the attempt `done`, only while it is `running`; undefined (nothing written) otherwise. */
  complete(workspaceId: string, prId: string, result: IntentResult): Promise<IntentRecord | undefined>;
  /** An active attempt → `failed` with why and what it billed; the last result stays. A finished attempt is left as it is. */
  fail(workspaceId: string, prId: string, failure: IntentFailure): Promise<void>;
  /** Every workspace's active attempts → `failed` with `error`; how many (boot: their jobs died with the old process). */
  reapActive(error: string): Promise<number>;
}

/** The PRs an intent is derived for (the pulls repository, structurally). */
export interface IntentPullSource {
  pullInWorkspace(workspaceId: string, prId: string): Promise<{ pull: IntentPull; repo: IntentRepoRef } | undefined>;
  /** Replaces the PR's files and commits and updates its description and stats, atomically. */
  replaceDetail(prId: string, detail: PrDetail): Promise<void>;
}

/** The diff of a PR: `git diff base...head` when the clone has it, else the stored patches. */
export interface DiffSource {
  forPull(pull: IntentPull, repo: IntentRepoRef): Promise<UnifiedDiff>;
}

/** Reads a linked document by URL (the SSRF-safe fetcher, structurally). */
export interface IntentFetcher {
  fetch(url: URL, limits: { maxBytes: number }): Promise<{ bytes: Uint8Array; contentType: string | null }>;
}

/** Background work, as this module uses the JobRunner (structurally). */
export interface JobQueue {
  register(kind: string, handler: (payload: unknown, ctx: { jobId: string }) => Promise<void>): void;
  /** Resolves once the job row exists; the job runs later. */
  enqueue(workspaceId: string, kind: string, payload: unknown): Promise<{ id: string }>;
}

/** Structural subset of pino (`app.log`). */
export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
}

export interface IntentDeps {
  store: IntentStore;
  pulls: IntentPullSource;
  diffs: DiffSource;
  fetcher: IntentFetcher;
  jobs: JobQueue;
  /** Throws `ConfigError` when no GitHub token is configured. */
  github: () => Promise<GitHubClient>;
  /** Resolves a provider's client; throws `ConfigError` when its key isn't configured. */
  llm: (provider: Provider) => Promise<LLMProvider>;
  /** The workspace's model for the `review_intent` feature (Settings → Models, else the default). */
  model: (workspaceId: string) => Promise<FeatureModelChoice>;
  log: Logger;
}
