import { type Repo } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { parseRepoUrl, canonicalCloneUrl, toRepoDto } from './helpers.js';
import { CLONE_JOB_KIND, CLONE_DEPTH } from './constants.js';
import type { RepoDeps } from './ports.js';

/**
 * F1 — repos service. Business logic for the Repositories feature:
 *   - add / list / refresh / remove
 *   - the asynchronous `clone` job (real `git clone` via the GitClient adapter)
 *
 * No HTTP and no raw SQL live here — persistence goes through the RepoStore
 * port, pure transforms through helpers.ts, literals through constants.ts.
 */

/** Payload enqueued for (and consumed by) the `clone` job. */
export interface CloneJobPayload {
  repoId: string;
  owner: string;
  name: string;
  url: string;
}

export class RepoService {
  constructor(private deps: RepoDeps) {}

  /**
   * Register the `clone` job handler once. Clones via the GitClient adapter (which
   * authenticates with the stored GitHub PAT, so private repos work), then
   * persists the resulting path + last_polled_at.
   */
  registerCloneJobHandler(): void {
    this.deps.jobs.register(CLONE_JOB_KIND, async (payload) => {
      await this.runCloneJob(payload as CloneJobPayload);
    });
  }

  async runCloneJob(payload: CloneJobPayload): Promise<void> {
    const { repoId, owner, name } = payload;
    // Rebuilt from the validated segments, never taken from the payload: the
    // adapter adds the token per command, so it is never written to .git/config.
    const git = this.deps.git();
    const { path } = await git.clone({ owner, name }, canonicalCloneUrl(owner, name), {
      depth: CLONE_DEPTH,
    });
    // Resync fetches `origin/<default_branch>`, so store the branch the remote
    // really uses (`master`, `develop`, …) instead of the column's `main` default.
    const defaultBranch = await git.defaultBranch({ owner, name }).catch((err: unknown) => {
      this.deps.log?.warn({ err, repoId }, 'could not read the default branch; keeping the stored one');
      return undefined;
    });
    await this.deps.repos.updateClonePath(repoId, path, defaultBranch);

    // T2.2 — kick off the indexer in the background. ENQUEUE (not call) so the
    // clone job closes immediately and the (heavier) index runs as its own
    // job under JobRunner's timeout/retry. If the handler isn't registered
    // (e.g. repo-intel disabled at module wiring), enqueue() throws — log and
    // continue so the clone result is preserved either way.
    const workspaceId = await this.deps.repos.workspaceIdFor(repoId);
    if (workspaceId) {
      try {
        await this.deps.indexing.index(workspaceId, { repoId, owner, name });
      } catch (err) {
        this.deps.log?.warn({ err, repoId }, 'repo index request failed after clone (reindex to retry)');
        // No handler registered or transient enqueue failure — clone has
        // already succeeded, so we don't fail the job for an index-followup
        // miss. The user can hit POST /repos/:id/reindex to retry.
      }
    }
  }

  /**
   * Add a repo: parse the URL, dedupe within the workspace, persist, and enqueue
   * the real clone (non-blocking). `created` is false when the repo already
   * existed (the caller returns 200 instead of 201).
   */
  async add(
    workspaceId: string,
    userId: string,
    url: string,
  ): Promise<{ repo: Repo; created: boolean }> {
    const { owner, name } = parseRepoUrl(url);
    const fullName = `${owner}/${name}`;

    const { row, created } = await this.deps.repos.insertIfAbsent({ workspaceId, owner, name, fullName, createdBy: userId });
    if (!created) return { repo: toRepoDto(row), created: false };

    await this.deps.jobs.enqueue(workspaceId, CLONE_JOB_KIND, {
      repoId: row.id,
      owner,
      name,
      url: canonicalCloneUrl(owner, name),
    } satisfies CloneJobPayload);

    return { repo: toRepoDto(row), created: true };
  }

  async list(workspaceId: string): Promise<Repo[]> {
    const rows = await this.deps.repos.list(workspaceId);
    return rows.map(toRepoDto);
  }

  /** Re-fetch the clone for an existing repo (enqueues a fresh `clone` job). */
  async refresh(workspaceId: string, id: string): Promise<{ status: 'refreshing' }> {
    const repo = await this.deps.repos.getById(workspaceId, id);
    if (!repo) throw new NotFoundError('Repo not found');
    await this.deps.jobs.enqueue(workspaceId, CLONE_JOB_KIND, {
      repoId: repo.id,
      owner: repo.owner,
      name: repo.name,
      url: canonicalCloneUrl(repo.owner, repo.name),
    } satisfies CloneJobPayload);
    // T2.2 — also enqueue an incremental refresh. The two queue positions are
    // independent (p-queue doesn't FIFO across kinds), but `runIncremental` is
    // a no-op when `currentHead === lastIndexedSha`, so ordering is safe: if
    // refresh fires before the new clone settles, it cheaply exits; if after,
    // it picks up the new HEAD.
    try {
      await this.deps.indexing.refresh(workspaceId, { repoId: repo.id, owner: repo.owner, name: repo.name });
    } catch (err) {
      this.deps.log?.warn({ err, repoId: repo.id }, 'repo refresh index request failed');
      // No handler / transient enqueue failure — refresh button is best-effort.
    }
    return { status: 'refreshing' };
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    const ok = await this.deps.repos.remove(workspaceId, id);
    if (!ok) throw new NotFoundError('Repo not found');
  }
}
