import type { GitHubClient, PrDiffStats, PrMeta } from '@devdigest/shared';

/** What a poll reads and writes (the pulls repository provides it). */
export interface PollStore {
  repoInWorkspace(workspaceId: string, repoId: string): Promise<{ id: string; owner: string; name: string } | undefined>;
  upsertFromGitHub(workspaceId: string, repoId: string, pulls: PrMeta[]): Promise<number>;
  /** Up to `limit` of the repo's PRs whose diff stats are still unknown. */
  lackingDiffStats(repoId: string, limit: number): Promise<{ id: string; number: number }[]>;
  saveDiffStats(repoId: string, stats: PrDiffStats[]): Promise<void>;
  /** The newest PR `updated_at` a poll imported; null before the first poll. */
  syncWatermark(repoId: string): Promise<Date | null>;
  markPolled(repoId: string, at: Date, syncedThrough?: Date): Promise<void>;
}

/** Structural: Fastify's `app.log` satisfies it. */
export interface Logger {
  warn(obj: unknown, msg?: string): void;
}

export interface PollingDeps {
  pulls: PollStore;
  /** Throws when no GitHub token is configured. */
  github: () => Promise<GitHubClient>;
  log?: Logger;
  now?: () => Date;
}
