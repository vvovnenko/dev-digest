import { Octokit } from 'octokit';
import type {
  GitHubClient,
  RepoRef,
  PrMeta,
  PrDetail,
  PrStatus,
  GitHubReviewPayload,
  CreateReviewCommentInput,
  PrReviewComment,
  OpenPrPayload,
  CommitFilesPayload,
  IssueMeta,
  ListPullsOptions,
  PrDiffStats,
} from '@devdigest/shared';
import { withRetry, withTimeout } from '../../platform/resilience.js';

/**
 * For calls that create something (a review, a comment, a PR, a commit): a
 * timeout or 5xx may still have succeeded on GitHub, and a retry would post it
 * twice. Reads keep retrying.
 */
const NO_RETRY = { retries: 0 };

const TIMEOUT = 30_000;

/** GitHub's largest page for list endpoints. */
const PULLS_PER_PAGE = 100;
/** PRs per GraphQL diff-stats query (one aliased `pullRequest` field each). */
const STATS_PER_QUERY = 100;
/** Without GraphQL: at most this many PRs by REST per call, this many at a time. */
const REST_STATS_LIMIT = 30;
const REST_STATS_CONCURRENCY = 5;

type StatsNode = { number: number; additions: number; deletions: number; changedFiles: number } | null;

/** Structural: Fastify's `app.log` satisfies it. */
export interface AdapterLog {
  warn(obj: unknown, msg?: string): void;
}
type StatsData = { repository: Record<string, StatsNode> | null };

function mapStatus(state: string, merged: boolean | undefined): PrStatus {
  if (merged) return 'merged';
  if (state === 'closed') return 'closed';
  return 'open';
}

/**
 * GitHubClient over Octokit REST — thin. PAT auth (fine-grained).
 * Reads PR list/detail/files/commits/issue; posts reviews; opens PRs.
 */
export class OctokitGitHubClient implements GitHubClient {
  private octokit: Octokit;
  private log: AdapterLog | undefined;

  /** `octokit` is for tests; `log` reports a degraded path (GraphQL refused → REST). */
  constructor(token: string, opts: { octokit?: Octokit | undefined; log?: AdapterLog | undefined } = {}) {
    this.octokit = opts.octokit ?? new Octokit({ auth: token });
    this.log = opts.log;
  }

  async listPullRequests(repo: RepoRef, opts: ListPullsOptions = {}): Promise<PrMeta[]> {
    // Every state, most recently updated first, page by page. An update only moves
    // a PR to the top, so pages read later can repeat a row (deduped below) but
    // never skip one. With `updatedSince` we stop after the page that reaches it.
    // Each page retries and times out on its own, so a large repo is not squeezed
    // into one 30 s budget.
    const since = opts.updatedSince ? Date.parse(opts.updatedSince) : null;
    const byNumber = new Map<number, PrMeta>();
    for (let page = 1; ; page++) {
      const rows = await withRetry(() =>
        withTimeout(
          this.octokit.rest.pulls
            .list({
              owner: repo.owner,
              repo: repo.name,
              state: 'all',
              sort: 'updated',
              direction: 'desc',
              per_page: PULLS_PER_PAGE,
              page,
            })
            .then((res) => res.data),
          TIMEOUT,
        ),
      );
      for (const pr of rows) {
        byNumber.set(pr.number, {
          number: pr.number,
          title: pr.title,
          author: pr.user?.login ?? 'unknown',
          branch: pr.head.ref,
          base: pr.base.ref,
          head_sha: pr.head.sha,
          additions: 0,
          deletions: 0,
          files_count: 0, // not present on the list payload; populated by getPullRequest
          status: mapStatus(pr.state, Boolean(pr.merged_at)) as PrStatus,
          opened_at: pr.created_at,
          updated_at: pr.updated_at,
        });
      }
      if (rows.length < PULLS_PER_PAGE) break;
      const oldest = rows[rows.length - 1];
      if (since !== null && oldest && Date.parse(oldest.updated_at) < since) break;
    }
    return [...byNumber.values()];
  }

  async getDiffStats(repo: RepoRef, numbers: number[]): Promise<PrDiffStats[]> {
    const wanted = numbers.filter((n) => Number.isInteger(n) && n > 0);
    const out: PrDiffStats[] = [];
    for (let i = 0; i < wanted.length; i += STATS_PER_QUERY) {
      const batch = wanted.slice(i, i + STATS_PER_QUERY);
      // GraphQL refused (a token it won't take, an outage): a few by REST instead;
      // the poll asks again next time for the rest.
      const nodes = await this.statsByGraphql(repo, batch).catch((err: unknown) => {
        this.log?.warn(
          { err, repo: `${repo.owner}/${repo.name}`, prs: wanted.length - i },
          `GitHub GraphQL refused the diff-stats query; fetching up to ${REST_STATS_LIMIT} PRs by REST instead`,
        );
        return null;
      });
      if (!nodes) return [...out, ...(await this.statsByRest(repo, wanted.slice(i, i + REST_STATS_LIMIT)))];
      out.push(...nodes);
    }
    return out;
  }

  /** One query for up to 100 PRs: an aliased `pullRequest(number:)` field each. */
  private async statsByGraphql(repo: RepoRef, numbers: number[]): Promise<PrDiffStats[]> {
    const fields = numbers
      .map((n) => `p${n}: pullRequest(number: ${n}) { number additions deletions changedFiles }`)
      .join(' ');
    const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`;
    const data = await withRetry(() =>
      withTimeout(
        this.octokit.graphql<StatsData>(query, { owner: repo.owner, name: repo.name }).catch((err: unknown) => {
          // A number GitHub can't resolve fails the query but leaves the rest in `data`.
          const partial = (err as { data?: StatsData }).data;
          if (partial?.repository) return partial;
          throw err;
        }),
        TIMEOUT,
      ),
    );
    return Object.values(data.repository ?? {})
      .filter((node): node is NonNullable<StatsNode> => node != null)
      .map((node) => ({
        number: node.number,
        additions: node.additions,
        deletions: node.deletions,
        files_count: node.changedFiles,
      }));
  }

  private async statsByRest(repo: RepoRef, numbers: number[]): Promise<PrDiffStats[]> {
    const out: PrDiffStats[] = [];
    for (let i = 0; i < numbers.length; i += REST_STATS_CONCURRENCY) {
      const batch = await Promise.all(
        numbers.slice(i, i + REST_STATS_CONCURRENCY).map((n) =>
          withRetry(() =>
            withTimeout(this.octokit.rest.pulls.get({ owner: repo.owner, repo: repo.name, pull_number: n }), TIMEOUT),
          )
            .then(({ data }) => ({
              number: n,
              additions: data.additions,
              deletions: data.deletions,
              files_count: data.changed_files,
            }))
            .catch(() => null),
        ),
      );
      out.push(...batch.filter((s): s is PrDiffStats => s !== null));
    }
    return out;
  }

  async getPullRequest(repo: RepoRef, n: number): Promise<PrDetail> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const { data: pr } = await this.octokit.rest.pulls.get({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
          });
          // Every page: one page is 100 files, and a PR's reviewed diff falls back
          // to these files — a missing page means a partial review.
          const files = await this.octokit.paginate(this.octokit.rest.pulls.listFiles, {
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          const commits = await this.octokit.paginate(this.octokit.rest.pulls.listCommits, {
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          const linkedIssue = await this.resolveLinkedIssue(repo, pr.body ?? '');
          return {
            number: pr.number,
            title: pr.title,
            author: pr.user?.login ?? 'unknown',
            branch: pr.head.ref,
            base: pr.base.ref,
            head_sha: pr.head.sha,
            additions: pr.additions,
            deletions: pr.deletions,
            files_count: pr.changed_files,
            status: mapStatus(pr.state, Boolean(pr.merged_at)) as PrStatus,
            opened_at: pr.created_at,
            updated_at: pr.updated_at,
            body: pr.body,
            files: files.map((f) => ({
              path: f.filename,
              additions: f.additions,
              deletions: f.deletions,
              patch: f.patch,
            })),
            commits: commits.map((c) => ({
              sha: c.sha,
              message: c.commit.message,
              author: c.commit.author?.name ?? c.author?.login ?? 'unknown',
              committed_at: c.commit.author?.date,
            })),
            linked_issue: linkedIssue,
          };
        })(),
        TIMEOUT,
      ),
    );
  }

  /** linked issue via regex on PR body (#123 / closes #123). */
  private async resolveLinkedIssue(repo: RepoRef, body: string): Promise<IssueMeta | undefined> {
    const m = body.match(/(?:closes|fixes|resolves)?\s*#(\d+)/i);
    if (!m?.[1]) return undefined;
    try {
      return await this.getIssue(repo, Number(m[1]));
    } catch {
      return undefined;
    }
  }

  async postReview(
    repo: RepoRef,
    n: number,
    review: GitHubReviewPayload,
  ): Promise<{ id: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.createReview({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            body: review.body,
            event: review.event,
            ...(review.comments
              ? { comments: review.comments.map((c) => ({ path: c.path, line: c.line, body: c.body })) }
              : {}),
          });
          return { id: String(res.data.id) };
        })(),
        TIMEOUT,
      ),
      NO_RETRY,
    );
  }

  /** Shape an Octokit review-comment payload into our DTO. */
  private mapReviewComment(c: {
    id: number;
    path: string;
    line?: number | null;
    original_line?: number | null;
    side?: string | null;
    body: string;
    user: { login: string } | null;
    created_at: string;
    html_url: string;
    in_reply_to_id?: number;
  }): PrReviewComment {
    return {
      id: c.id,
      path: c.path,
      line: c.line ?? null,
      original_line: c.original_line ?? null,
      side: c.side === 'LEFT' ? 'LEFT' : 'RIGHT',
      body: c.body,
      user: c.user?.login ?? 'unknown',
      created_at: c.created_at,
      html_url: c.html_url,
      in_reply_to_id: c.in_reply_to_id ?? null,
      // GitHub drops `line` when the comment can no longer be placed on the diff.
      is_outdated: c.line == null,
    };
  }

  async listReviewComments(repo: RepoRef, n: number): Promise<PrReviewComment[]> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.listReviewComments({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            per_page: 100,
          });
          return res.data.map((c) => this.mapReviewComment(c));
        })(),
        TIMEOUT,
      ),
    );
  }

  async createReviewComment(
    repo: RepoRef,
    n: number,
    input: CreateReviewCommentInput,
  ): Promise<PrReviewComment> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          if (input.inReplyTo != null) {
            const res = await this.octokit.rest.pulls.createReplyForReviewComment({
              owner: repo.owner,
              repo: repo.name,
              pull_number: n,
              comment_id: input.inReplyTo,
              body: input.body,
            });
            return this.mapReviewComment(res.data);
          }
          const res = await this.octokit.rest.pulls.createReviewComment({
            owner: repo.owner,
            repo: repo.name,
            pull_number: n,
            commit_id: input.commitId,
            path: input.path,
            line: input.line,
            side: input.side ?? 'RIGHT',
            body: input.body,
          });
          return this.mapReviewComment(res.data);
        })(),
        TIMEOUT,
      ),
      NO_RETRY,
    );
  }

  async openPullRequest(repo: RepoRef, payload: OpenPrPayload): Promise<{ url: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.create({
            owner: repo.owner,
            repo: repo.name,
            title: payload.title,
            head: payload.head,
            base: payload.base,
            body: payload.body,
          });
          return { url: res.data.html_url };
        })(),
        TIMEOUT,
      ),
      NO_RETRY,
    );
  }

  async commitFiles(
    repo: RepoRef,
    payload: CommitFilesPayload,
  ): Promise<{ branch: string }> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const owner = repo.owner;
          const name = repo.name;
          const g = this.octokit.rest.git;

          // Parent commit: the target branch if it already exists, else the base.
          let parentSha: string;
          let branchExists = false;
          try {
            const ref = await g.getRef({ owner, repo: name, ref: `heads/${payload.branch}` });
            parentSha = ref.data.object.sha;
            branchExists = true;
          } catch {
            const baseRef = await g.getRef({ owner, repo: name, ref: `heads/${payload.base}` });
            parentSha = baseRef.data.object.sha;
          }

          // New tree layered on the parent's tree (so unrelated files are kept).
          const parentCommit = await g.getCommit({ owner, repo: name, commit_sha: parentSha });
          const tree = await g.createTree({
            owner,
            repo: name,
            base_tree: parentCommit.data.tree.sha,
            tree: payload.files.map((f) => ({
              path: f.path,
              mode: '100644',
              type: 'blob',
              content: f.contents,
            })),
          });

          const commit = await g.createCommit({
            owner,
            repo: name,
            message: payload.message,
            tree: tree.data.sha,
            parents: [parentSha],
          });

          if (branchExists) {
            await g.updateRef({
              owner,
              repo: name,
              ref: `heads/${payload.branch}`,
              sha: commit.data.sha,
              force: true,
            });
          } else {
            await g.createRef({
              owner,
              repo: name,
              ref: `refs/heads/${payload.branch}`,
              sha: commit.data.sha,
            });
          }
          return { branch: payload.branch };
        })(),
        TIMEOUT,
      ),
      NO_RETRY,
    );
  }

  async findOpenPr(repo: RepoRef, branch: string): Promise<{ url: string } | null> {
    return withRetry(() =>
      withTimeout(
        (async () => {
          const res = await this.octokit.rest.pulls.list({
            owner: repo.owner,
            repo: repo.name,
            state: 'open',
            head: `${repo.owner}:${branch}`,
            per_page: 1,
          });
          const pr = res.data[0];
          return pr ? { url: pr.html_url } : null;
        })(),
        TIMEOUT,
      ),
    );
  }

  async getIssue(repo: RepoRef, n: number): Promise<IssueMeta> {
    const res = await withRetry(() =>
      withTimeout(
        this.octokit.rest.issues.get({ owner: repo.owner, repo: repo.name, issue_number: n }),
        TIMEOUT,
      ),
    );
    return {
      number: res.data.number,
      title: res.data.title,
      body: res.data.body,
      state: res.data.state,
    };
  }

  async currentLogin(): Promise<string> {
    const res = await withRetry(() =>
      withTimeout(this.octokit.rest.users.getAuthenticated(), TIMEOUT),
    );
    return res.data.login;
  }
}
