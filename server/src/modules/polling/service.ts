import { NotFoundError } from '../../platform/errors.js';
import { newestUpdate, statsTargets } from './domain.js';
import type { PollingDeps } from './ports.js';

/**
 * PRs whose diff stats one poll refreshes at most. GitHub's PR list has no
 * stats, so they come in batches of 100 per GraphQL query (10 queries here);
 * the next poll picks up the rest.
 */
export const STATS_PER_POLL = 1000;

/**
 * The one way PRs get imported: `GET /repos/:id/pulls` only reads what is
 * stored. A poll is incremental — the first reads every page, later ones only
 * the PRs updated since the last — then refreshes diff stats and stamps the
 * repo. It never triggers a review — that is manual (Run Review, owned by A2).
 */
export class PollingService {
  constructor(private deps: PollingDeps) {}

  async poll(workspaceId: string, repoId: string): Promise<{ synced: number; reviewTriggered: false }> {
    const repo = await this.deps.pulls.repoInWorkspace(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    const gh = await this.deps.github();
    const ref = { owner: repo.owner, name: repo.name };

    const since = await this.deps.pulls.syncWatermark(repo.id);
    const pulls = await gh.listPullRequests(ref, since ? { updatedSince: since.toISOString() } : {});
    const synced = await this.deps.pulls.upsertFromGitHub(workspaceId, repo.id, pulls);

    const lacking = await this.deps.pulls.lackingDiffStats(repo.id, STATS_PER_POLL);
    const targets = statsTargets(
      pulls.map((p) => p.number),
      lacking.map((p) => p.number),
      STATS_PER_POLL,
    );
    if (targets.length > 0) {
      try {
        await this.deps.pulls.saveDiffStats(repo.id, await gh.getDiffStats(ref, targets));
      } catch (err) {
        this.deps.log?.warn({ err, repoId: repo.id }, 'PR diff-stat refresh skipped');
      }
    }

    // Move the watermark only after the PRs are stored: a failed poll re-reads them next time.
    await this.deps.pulls.markPolled(repo.id, this.deps.now?.() ?? new Date(), newestUpdate(pulls) ?? undefined);
    return { synced, reviewTriggered: false };
  }
}
