import type { GitHubClient, PrDetail } from '@devdigest/shared';
import type { PrCommitRecord, PrFileRecord, PullRecord, PullRepoRef, PullRollup } from './domain.js';

export interface PullStore {
  repoInWorkspace(workspaceId: string, repoId: string): Promise<PullRepoRef | undefined>;
  pullInWorkspace(workspaceId: string, prId: string): Promise<{ pull: PullRecord; repo: PullRepoRef } | undefined>;
  /** Upsert a repo's PRs from GitHub's list; returns how many it reported. */
  /** Newest number first, one page. */
  listForRepo(repoId: string, page: { limit: number; offset: number }): Promise<PullRecord[]>;
  /** Per PR id; a PR with no review and no known cost is absent. */
  rollups(prIds: string[]): Promise<Map<string, PullRollup>>;
  /** Replace files and commits and update body/stats, atomically. */
  replaceDetail(prId: string, detail: PrDetail): Promise<void>;
  storedDetail(prId: string): Promise<{ files: PrFileRecord[]; commits: PrCommitRecord[] }>;
}

/** Structural subset of pino (`app.log`). */
export interface Logger {
  warn(obj: unknown, msg?: string): void;
}

export interface PullsDeps {
  pulls: PullStore;
  /** Throws when no GitHub token is configured. */
  github: () => Promise<GitHubClient>;
  log: Logger;
  now?: () => number;
}
