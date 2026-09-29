import type { PrDetail, PrMeta, PrStatus } from '@devdigest/shared';

/**
 * Pulls domain: the stored PR shapes, the PR-list rollup and review-status
 * rules, and the mapping to the API contracts. Pure — no DB / `this`, so it
 * unit-tests cleanly.
 *
 * PR-list rollup helpers.
 *
 * The Pull Requests list shows, per PR: the latest review's SCORE, a FINDINGS
 * severity breakdown, and a review STATUS. The DB `status` column holds
 * GitHub's merge state (open/merged/closed); the review status
 * (needs_review / reviewed / stale) is DERIVED here for OPEN PRs from the
 * commit a review last ran against (`lastReviewedSha`) vs the PR head, plus age.
 */

/** Open PRs whose current head was reviewed but untouched this long read "stale". */
export const STALE_DAYS = 7;

export interface SeverityCounts {
  critical: number;
  warning: number;
  suggestion: number;
}

/** Tally finding severities (CRITICAL / WARNING / SUGGESTION) for one review. */
export function rollupSeverities(rows: { severity: string }[]): SeverityCounts {
  const c: SeverityCounts = { critical: 0, warning: 0, suggestion: 0 };
  for (const r of rows) {
    if (r.severity === 'CRITICAL') c.critical += 1;
    else if (r.severity === 'WARNING') c.warning += 1;
    else if (r.severity === 'SUGGESTION') c.suggestion += 1;
  }
  return c;
}

/**
 * Review-freshness status for the PR list. Merged/closed PRs keep their GitHub
 * merge state; open PRs map to:
 *  - `needs_review` — never reviewed, OR head moved since the last review
 *  - `stale`        — current head was reviewed but the PR is older than STALE_DAYS
 *  - `reviewed`     — current head reviewed and recent
 */
export function deriveReviewStatus(args: {
  /** DB `status` column = GitHub merge state (open/merged/closed). */
  ghStatus: string;
  lastReviewedSha: string | null;
  headSha: string;
  updatedAt: Date | null;
  now: number;
  staleDays?: number;
}): PrStatus {
  const { ghStatus, lastReviewedSha, headSha, updatedAt, now } = args;
  if (ghStatus === 'merged' || ghStatus === 'closed') return ghStatus as PrStatus;
  if (!lastReviewedSha || lastReviewedSha !== headSha) return 'needs_review';
  const staleMs = (args.staleDays ?? STALE_DAYS) * 86_400_000;
  if (updatedAt && now - updatedAt.getTime() > staleMs) return 'stale';
  return 'reviewed';
}

/** A stored pull request. `status` is GitHub's merge state (open/merged/closed). */
export interface PullRecord {
  id: string;
  workspaceId: string;
  repoId: string;
  number: number;
  title: string;
  author: string;
  branch: string;
  base: string;
  headSha: string;
  lastReviewedSha: string | null;
  additions: number;
  deletions: number;
  filesCount: number;
  status: string;
  body: string | null;
  openedAt: Date | null;
  updatedAt: Date | null;
}

/** The GitHub coordinates of a PR's repo. */
export interface PullRepoRef {
  id: string;
  owner: string;
  name: string;
}

export interface PrFileRecord {
  path: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

export interface PrCommitRecord {
  sha: string;
  message: string;
  author: string;
  committedAt: Date | null;
}

/** What the PR list shows from a PR's reviews and runs (spec 01 cost, spec 02 findings). */
export interface PullRollup {
  /** The latest review's score. */
  score: number | null;
  /** The latest review's findings per severity, dismissed included; null with no review. */
  findingsBySeverity: PrMeta['findings_by_severity'];
  /** Sum of `cost_usd` over the PR's `done` runs; null when none is known. */
  costUsd: number | null;
}

export const EMPTY_ROLLUP: PullRollup = { score: null, findingsBySeverity: null, costUsd: null };

/** One row of the PR list. */
export function toPrMeta(pull: PullRecord, rollup: PullRollup, now: number): PrMeta {
  return {
    id: pull.id,
    number: pull.number,
    title: pull.title,
    author: pull.author,
    branch: pull.branch,
    base: pull.base,
    head_sha: pull.headSha,
    additions: pull.additions,
    deletions: pull.deletions,
    files_count: pull.filesCount,
    status: deriveReviewStatus({
      ghStatus: pull.status,
      lastReviewedSha: pull.lastReviewedSha,
      headSha: pull.headSha,
      updatedAt: pull.updatedAt,
      now,
    }),
    opened_at: pull.openedAt?.toISOString() ?? null,
    updated_at: pull.updatedAt?.toISOString() ?? null,
    score: rollup.score,
    cost_usd: rollup.costUsd,
    findings_by_severity: rollup.findingsBySeverity,
  };
}

/** PR detail from what is stored — served when GitHub can't be reached. */
export function toStoredDetail(pull: PullRecord, files: PrFileRecord[], commits: PrCommitRecord[]): PrDetail {
  return {
    id: pull.id,
    number: pull.number,
    title: pull.title,
    author: pull.author,
    branch: pull.branch,
    base: pull.base,
    head_sha: pull.headSha,
    additions: pull.additions,
    deletions: pull.deletions,
    files_count: pull.filesCount,
    status: pull.status as PrDetail['status'],
    opened_at: pull.openedAt?.toISOString() ?? null,
    updated_at: pull.updatedAt?.toISOString() ?? null,
    body: pull.body ?? null,
    files: files.map((f) => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch ?? null,
    })),
    commits: commits.map((c) => ({
      sha: c.sha,
      message: c.message,
      author: c.author,
      committed_at: c.committedAt?.toISOString() ?? null,
    })),
  };
}
