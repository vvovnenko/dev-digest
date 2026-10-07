import { and, count, desc, eq, inArray, sql, sum } from 'drizzle-orm';
import type { PrDetail, PrDiffStats, PrMeta } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { PrCommitRecord, PrFileRecord, PullRecord, PullRepoRef, PullRollup } from './domain.js';
import type { PullStore } from './ports.js';

const repoRef = { id: t.repos.id, owner: t.repos.owner, name: t.repos.name };

/** PR rows per upsert statement: 14 parameters each, far under Postgres's 65 535. */
const UPSERT_CHUNK = 500;

/**
 * Pulls persistence: writing what GitHub reports about a repo's pull requests.
 * The one place PRs are upserted and their files/commits replaced, so the
 * list sync, the poll and the detail refresh can't drift apart again — and
 * the reads behind the PR list and PR detail. Workspace-scoped at the entry
 * points (`repoInWorkspace`, `pullInWorkspace`); the rest take ids from them.
 */
export class PullsRepository implements PullStore {
  constructor(private db: Db) {}

  async repoInWorkspace(workspaceId: string, repoId: string): Promise<PullRepoRef | undefined> {
    const [repo] = await this.db
      .select(repoRef)
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return repo;
  }

  async pullInWorkspace(
    workspaceId: string,
    prId: string,
  ): Promise<{ pull: PullRecord; repo: PullRepoRef } | undefined> {
    const [row] = await this.db
      .select({ pull: t.pullRequests, repo: repoRef })
      .from(t.pullRequests)
      .innerJoin(t.repos, eq(t.repos.id, t.pullRequests.repoId))
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    return row;
  }

  /** A repo's PRs, newest number first, one page. */
  async listForRepo(repoId: string, page: { limit: number; offset: number }): Promise<PullRecord[]> {
    return this.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.repoId, repoId))
      .orderBy(desc(t.pullRequests.number))
      .limit(page.limit)
      .offset(page.offset);
  }

  /**
   * PRs whose diff stats are still unknown: GitHub's PR-list payload has none, so
   * an imported PR is stored with 0 / 0 / 0 until a detail call fills them in.
   */
  async lackingDiffStats(repoId: string, limit: number): Promise<{ id: string; number: number }[]> {
    return this.db
      .select({ id: t.pullRequests.id, number: t.pullRequests.number })
      .from(t.pullRequests)
      .where(
        and(
          eq(t.pullRequests.repoId, repoId),
          eq(t.pullRequests.additions, 0),
          eq(t.pullRequests.deletions, 0),
          eq(t.pullRequests.filesCount, 0),
        ),
      )
      .orderBy(desc(t.pullRequests.number))
      .limit(limit);
  }

  /** A repo's PR diff stats by number, in one transaction. */
  async saveDiffStats(repoId: string, stats: PrDiffStats[]): Promise<void> {
    if (stats.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (const s of stats) {
        await tx
          .update(t.pullRequests)
          .set({ additions: s.additions, deletions: s.deletions, filesCount: s.files_count })
          .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, s.number)));
      }
    });
  }

  /** Where the last poll got to: the newest PR `updated_at` it imported (null: never polled). */
  async syncWatermark(repoId: string): Promise<Date | null> {
    const [row] = await this.db
      .select({ at: t.repos.pullsSyncedThrough })
      .from(t.repos)
      .where(eq(t.repos.id, repoId));
    return row?.at ?? null;
  }

  /** The poll's timestamp on the repo, and the new watermark when this poll moved it. */
  async markPolled(repoId: string, at: Date, syncedThrough?: Date): Promise<void> {
    await this.db
      .update(t.repos)
      .set({ lastPolledAt: at, ...(syncedThrough ? { pullsSyncedThrough: syncedThrough } : {}) })
      .where(eq(t.repos.id, repoId));
  }

  /**
   * Per-PR SCORE + FINDINGS of the latest review, and COST of all done runs, for
   * the list. Computed on read (no denormalised columns); the list is small, so
   * IN-queries + grouping here are cheap. FINDINGS is the latest review's
   * per-severity count, dismissed included (server/specs/02-findings-by-severity.md).
   * COST is the sum of `cost_usd` over every `done` run of the PR, the same runs
   * the Timeline lists; unknown (NULL) costs are skipped, and a PR with no known
   * cost gets null (server/specs/01-run-cost-badge.md, Amendment).
   */
  async rollups(prIds: string[]): Promise<Map<string, PullRollup>> {
    const out = new Map<string, PullRollup>();
    if (prIds.length === 0) return out;
    const rollupOf = (prId: string) => {
      let r = out.get(prId);
      if (!r) out.set(prId, (r = { score: null, findingsBySeverity: null, costUsd: null }));
      return r;
    };

    const reviewRows = await this.db
      .select({ id: t.reviews.id, prId: t.reviews.prId, score: t.reviews.score })
      .from(t.reviews)
      .where(and(inArray(t.reviews.prId, prIds), eq(t.reviews.kind, 'review')))
      .orderBy(desc(t.reviews.createdAt));
    // Rows are newest-first → the first one seen per PR is its latest review.
    const latestByPr = new Map<string, string>();
    for (const rv of reviewRows) {
      if (latestByPr.has(rv.prId)) continue;
      latestByPr.set(rv.prId, rv.id);
      const r = rollupOf(rv.prId);
      r.score = rv.score;
      r.findingsBySeverity = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
    }

    // Summed in SQL over numeric `cost_usd`, so the total is exact; sum() skips NULL
    // costs and is NULL for a PR with none.
    const runCostRows = await this.db
      .select({ prId: t.agentRuns.prId, costUsd: sum(t.agentRuns.costUsd).mapWith(Number) })
      .from(t.agentRuns)
      .where(and(inArray(t.agentRuns.prId, prIds), eq(t.agentRuns.status, 'done')))
      .groupBy(t.agentRuns.prId);
    for (const run of runCostRows) {
      if (run.prId == null || run.costUsd == null) continue;
      rollupOf(run.prId).costUsd = run.costUsd;
    }

    const latestIds = [...latestByPr.values()];
    if (latestIds.length > 0) {
      const prOfReview = new Map([...latestByPr].map(([prId, reviewId]) => [reviewId, prId]));
      const countRows = await this.db
        .select({ reviewId: t.findings.reviewId, severity: t.findings.severity, n: count() })
        .from(t.findings)
        .where(inArray(t.findings.reviewId, latestIds))
        .groupBy(t.findings.reviewId, t.findings.severity);
      for (const c of countRows) {
        const counts = out.get(prOfReview.get(c.reviewId)!)?.findingsBySeverity;
        if (counts && (c.severity === 'CRITICAL' || c.severity === 'WARNING' || c.severity === 'SUGGESTION')) {
          counts[c.severity] = c.n;
        }
      }
    }
    return out;
  }

  async storedDetail(prId: string): Promise<{ files: PrFileRecord[]; commits: PrCommitRecord[] }> {
    const files = await this.db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
    const commits = await this.db.select().from(t.prCommits).where(eq(t.prCommits.prId, prId));
    return { files, commits };
  }

  /**
   * Upsert a repo's PRs from GitHub's list in one statement. On conflict it
   * refreshes everything the list reports (title, author, branch, base, head,
   * status, opened/updated) but keeps diff stats, which the list payload
   * doesn't carry (zeros there) and the detail refresh fills in.
   */
  async upsertFromGitHub(workspaceId: string, repoId: string, pulls: PrMeta[]): Promise<number> {
    // One row per number (an upsert can't touch a row twice in one statement).
    const unique = [...new Map(pulls.map((pr) => [pr.number, pr])).values()];
    if (unique.length === 0) return 0;
    const rows = unique.map((pr) => ({
      workspaceId,
      repoId,
      number: pr.number,
      title: pr.title,
      author: pr.author,
      branch: pr.branch,
      base: pr.base,
      headSha: pr.head_sha,
      additions: pr.additions,
      deletions: pr.deletions,
      filesCount: pr.files_count,
      status: pr.status,
      openedAt: pr.opened_at ? new Date(pr.opened_at) : null,
      updatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
    }));
    // A whole repo's PRs can be thousands of rows: chunked statements (Postgres
    // allows 65 535 parameters per statement), all in one transaction.
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
        await tx
          .insert(t.pullRequests)
          .values(rows.slice(i, i + UPSERT_CHUNK))
          .onConflictDoUpdate({
            target: [t.pullRequests.repoId, t.pullRequests.number],
            set: {
              title: sql`excluded.title`,
              author: sql`excluded.author`,
              branch: sql`excluded.branch`,
              // A retargeted PR must be diffed against its new base.
              base: sql`excluded.base`,
              headSha: sql`excluded.head_sha`,
              status: sql`excluded.status`,
              openedAt: sql`coalesce(excluded.opened_at, ${t.pullRequests.openedAt})`,
              updatedAt: sql`excluded.updated_at`,
            },
          });
      }
    });
    return unique.length;
  }

  /**
   * Replace a PR's files and commits with a fresh GitHub detail and update its
   * body and stats — in one transaction, so a failure can't leave the PR with
   * its files deleted, and two concurrent refreshes can't duplicate them.
   */
  async replaceDetail(prId: string, detail: PrDetail): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(t.prFiles).where(eq(t.prFiles.prId, prId));
      if (detail.files.length > 0) {
        await tx
          .insert(t.prFiles)
          .values(
            detail.files.map((f) => ({
              prId,
              path: f.path,
              additions: f.additions,
              deletions: f.deletions,
              patch: f.patch ?? null,
            })),
          )
          .onConflictDoNothing({ target: [t.prFiles.prId, t.prFiles.path] });
      }
      await tx.delete(t.prCommits).where(eq(t.prCommits.prId, prId));
      if (detail.commits.length > 0) {
        await tx
          .insert(t.prCommits)
          .values(
            detail.commits.map((c) => ({
              prId,
              sha: c.sha,
              message: c.message,
              author: c.author,
              committedAt: c.committed_at ? new Date(c.committed_at) : null,
            })),
          )
          .onConflictDoNothing({ target: [t.prCommits.prId, t.prCommits.sha] });
      }
      await tx
        .update(t.pullRequests)
        .set({
          body: detail.body ?? null,
          // Diff stats aren't on GitHub's PR-list payload — backfill them from
          // the detail fetch so the Pull Requests list shows real size/files.
          additions: detail.additions,
          deletions: detail.deletions,
          filesCount: detail.files_count,
        })
        .where(eq(t.pullRequests.id, prId));
    });
  }
}
