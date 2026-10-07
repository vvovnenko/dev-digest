import type { GitClient } from '@devdigest/shared';
import type { RepoRecord } from './domain.js';

export interface NewRepo {
  workspaceId: string;
  owner: string;
  name: string;
  fullName: string;
  createdBy: string;
}

export interface RepoStore {
  list(workspaceId: string): Promise<RepoRecord[]>;
  getById(workspaceId: string, id: string): Promise<RepoRecord | undefined>;
  /** Insert unless the workspace already tracks it (case-insensitively); `created` says which. */
  insertIfAbsent(values: NewRepo): Promise<{ row: RepoRecord; created: boolean }>;
  workspaceIdFor(repoId: string): Promise<string | null>;
  /** After a clone: its path, and the default branch when the clone could tell it. */
  updateClonePath(repoId: string, clonePath: string, defaultBranch?: string): Promise<void>;
  remove(workspaceId: string, id: string): Promise<boolean>;
}

/** Background work, as the repos module uses the JobRunner. */
export interface JobQueue {
  register(kind: string, handler: (payload: unknown) => Promise<void>): void;
  enqueue(workspaceId: string, kind: string, payload: unknown): Promise<unknown>;
}

/** The repo a code-index request is about. */
export interface IndexTarget {
  repoId: string;
  owner: string;
  name: string;
}

/**
 * Asks the code indexer to (re)index a clone. Throws when no indexer is wired
 * (repo-intel disabled); callers treat indexing as best-effort.
 */
export interface RepoIndexing {
  index(workspaceId: string, repo: IndexTarget): Promise<void>;
  refresh(workspaceId: string, repo: IndexTarget): Promise<void>;
}

/** Structural subset of pino (`app.log`). */
export interface Logger {
  warn(obj: unknown, msg?: string): void;
}

export interface RepoDeps {
  repos: RepoStore;
  jobs: JobQueue;
  /** Lazy: the git adapter is built on first use. */
  git: () => GitClient;
  indexing: RepoIndexing;
  log?: Logger;
}
