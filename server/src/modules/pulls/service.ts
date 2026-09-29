import type { GitHubClient, PrCommentInput, PrDetail, PrMeta, PrReviewComment } from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import { EMPTY_ROLLUP, toPrMeta, toStoredDetail } from './domain.js';
import type { Logger, PullsDeps } from './ports.js';

/**
 * F1 — pulls: read PRs back, and refresh one PR's detail from GitHub. Local-first:
 * a GitHub failure never fails a read — imported/seeded PRs stay viewable
 * offline. The PR list is read-only; importing it is `POST /repos/:id/poll`
 * (the polling module).
 */
export class PullsService {
  constructor(private deps: PullsDeps) {}

  /** The GitHub client, or null (logged) when there is no token or it can't be built. */
  private async githubOrNull(context: string, log: Logger): Promise<GitHubClient | null> {
    try {
      return await this.deps.github();
    } catch (err) {
      log.warn({ err }, context);
      return null;
    }
  }

  /**
   * PRs of a repo as stored, with their review roll-ups. No GitHub call: the list
   * is polled every minute and must stay cheap; `POST /repos/:id/poll` imports.
   */
  async listForRepo(workspaceId: string, repoId: string, page: { limit: number; offset: number }): Promise<PrMeta[]> {
    const repo = await this.deps.pulls.repoInWorkspace(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const pulls = await this.deps.pulls.listForRepo(repo.id, page);
    const rollups = await this.deps.pulls.rollups(pulls.map((p) => p.id));
    const now = this.deps.now?.() ?? Date.now();
    return pulls.map((p) => toPrMeta(p, rollups.get(p.id) ?? EMPTY_ROLLUP, now));
  }

  /** Full PR detail: refreshed from GitHub when possible, else what is stored. */
  async detail(workspaceId: string, prId: string, log: Logger = this.deps.log): Promise<PrDetail> {
    const { pull, repo } = await this.pullAndRepo(workspaceId, prId);
    // Only the GitHub call may fail quietly — a DB error must not be reported as "GitHub skipped".
    let detail: PrDetail | null = null;
    try {
      const gh = await this.deps.github();
      detail = await gh.getPullRequest({ owner: repo.owner, name: repo.name }, pull.number);
    } catch (err) {
      log.warn({ err }, 'GitHub PR detail refresh skipped (no token / offline); serving persisted detail');
    }
    if (detail) {
      await this.deps.pulls.replaceDetail(pull.id, detail);
      return { ...detail, id: pull.id };
    }
    const { files, commits } = await this.deps.pulls.storedDetail(pull.id);
    return toStoredDetail(pull, files, commits);
  }

  /** Inline review comments, read live from GitHub (none offline). */
  async comments(workspaceId: string, prId: string, log: Logger = this.deps.log): Promise<PrReviewComment[]> {
    const { pull, repo } = await this.pullAndRepo(workspaceId, prId);
    const gh = await this.githubOrNull('GitHub client unavailable; serving no PR comments', log);
    if (!gh) return [];
    try {
      return await gh.listReviewComments({ owner: repo.owner, name: repo.name }, pull.number);
    } catch (err) {
      log.warn({ err }, 'GitHub review-comments fetch skipped (offline / error)');
      return [];
    }
  }

  /** Post an inline review comment to GitHub on the PR's head commit. */
  async addComment(workspaceId: string, prId: string, input: PrCommentInput): Promise<PrReviewComment> {
    const { pull, repo } = await this.pullAndRepo(workspaceId, prId);
    let gh: GitHubClient;
    try {
      gh = await this.deps.github();
    } catch {
      throw new AppError('github_unavailable', 'Connect a GitHub token to post comments.', 400);
    }
    try {
      return await gh.createReviewComment({ owner: repo.owner, name: repo.name }, pull.number, {
        commitId: pull.headSha,
        path: input.path,
        line: input.line,
        ...(input.side ? { side: input.side } : {}),
        body: input.body,
        ...(input.in_reply_to != null ? { inReplyTo: input.in_reply_to } : {}),
      });
    } catch (err) {
      // GitHub rejects comments on lines outside the diff / on closed PRs (422).
      const msg = err instanceof Error ? err.message : 'Failed to post the comment to GitHub.';
      throw new AppError('github_comment_failed', msg, 400, { cause: String(err) });
    }
  }

  private async pullAndRepo(workspaceId: string, prId: string) {
    const found = await this.deps.pulls.pullInWorkspace(workspaceId, prId);
    if (!found) throw new NotFoundError('Pull request not found');
    return found;
  }
}
