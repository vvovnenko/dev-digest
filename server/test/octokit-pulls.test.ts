import { describe, it, expect } from 'vitest';
import type { Octokit } from 'octokit';
import { OctokitGitHubClient } from '../src/adapters/github/octokit.js';

/**
 * The PR list reads every page — 100 PRs a page, most recently updated first,
 * until a short page, or with `updatedSince` down to it — and keeps a PR seen on
 * two pages once. Diff stats come 100 PRs per GraphQL query, else a few by REST.
 */
function pr(n: number, updatedAt = '2026-09-02T00:00:00Z') {
  return {
    number: n,
    title: `PR ${n}`,
    user: { login: 'dev' },
    head: { ref: 'feat', sha: `sha${n}` },
    base: { ref: 'main' },
    state: 'open',
    merged_at: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: updatedAt,
  };
}

/** PR n was last updated n hours into 2026-09-01. */
const hour = (n: number) => new Date(Date.UTC(2026, 8, 1, n)).toISOString();

/**
 * A fake Octokit serving `pages` (arrays of PR numbers, PR n updated at `hour(n)`)
 * and recording each `pulls.list` call; `graphql` and `pulls.get` are swappable.
 */
function fakeOctokit(pages: number[][]) {
  const calls: Record<string, unknown>[] = [];
  const octokit = {
    rest: {
      pulls: {
        list: async (params: { page: number } & Record<string, unknown>) => {
          calls.push(params);
          return { data: (pages[params.page - 1] ?? []).map((n) => pr(n, hour(n))) };
        },
        get: async ({ pull_number }: { pull_number: number }) => ({
          data: { additions: pull_number, deletions: 1, changed_files: 2 },
        }),
      },
    },
    graphql: async (_query: string, _vars: unknown): Promise<unknown> => ({ repository: {} }),
  } as unknown as Octokit & { graphql: (q: string, v: unknown) => Promise<unknown> };
  return { octokit, calls };
}

/** A GraphQL answer for the `p<n>:` aliases in `query`. */
function statsAnswer(query: string, missing: number[] = []) {
  const numbers = [...query.matchAll(/p(\d+): pullRequest/g)].map((m) => Number(m[1]));
  return Object.fromEntries(
    numbers.map((n) => [`p${n}`, missing.includes(n) ? null : { number: n, additions: n, deletions: 1, changedFiles: 2 }]),
  );
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => to - i);

describe('OctokitGitHubClient.listPullRequests', () => {
  it('reads every page until a short one, 100 at a time, in all states', async () => {
    const { octokit, calls } = fakeOctokit([range(151, 250), range(51, 150), range(1, 50)]);
    const pulls = await new OctokitGitHubClient('t', { octokit }).listPullRequests({ owner: 'acme', name: 'app' });

    expect(pulls).toHaveLength(250);
    expect(calls.map((c) => c.page)).toEqual([1, 2, 3]);
    expect(calls[0]).toMatchObject({ owner: 'acme', repo: 'app', state: 'all', sort: 'updated', per_page: 100 });
    expect(pulls[0]).toMatchObject({ number: 250, status: 'open', head_sha: 'sha250', files_count: 0 });
  });

  it('asks for one more page after a full one, and keeps a PR repeated across pages once', async () => {
    // A PR updated mid-read moves to the top and pushes #101 onto page 2 as well.
    const { octokit, calls } = fakeOctokit([range(101, 200), [101], []]);
    const pulls = await new OctokitGitHubClient('t', { octokit }).listPullRequests({ owner: 'acme', name: 'app' });

    expect(calls.map((c) => c.page)).toEqual([1, 2]);
    expect(pulls).toHaveLength(100);
    expect(pulls.filter((p) => p.number === 101)).toHaveLength(1);
  });

  it('stops after an empty page when the total is a multiple of 100', async () => {
    const { octokit, calls } = fakeOctokit([range(1, 100)]);
    const pulls = await new OctokitGitHubClient('t', { octokit }).listPullRequests({ owner: 'acme', name: 'app' });
    expect(pulls).toHaveLength(100);
    expect(calls.map((c) => c.page)).toEqual([1, 2]);
  });

  it('with updatedSince, stops after the page that reaches it', async () => {
    const { octokit, calls } = fakeOctokit([range(201, 300), range(101, 200), range(1, 100)]);
    const pulls = await new OctokitGitHubClient('t', { octokit }).listPullRequests(
      { owner: 'acme', name: 'app' },
      { updatedSince: hour(150) },
    );
    expect(calls.map((c) => c.page)).toEqual([1, 2]); // page 2 reaches PR 150; page 3 is never read
    expect(pulls).toHaveLength(200);
  });
});

describe('OctokitGitHubClient.getDiffStats', () => {
  it('asks GraphQL for 100 PRs per query and maps changedFiles to files_count', async () => {
    const { octokit } = fakeOctokit([]);
    const queries: string[] = [];
    octokit.graphql = (async (query: string) => {
      queries.push(query);
      return { repository: statsAnswer(query) };
    }) as unknown as typeof octokit.graphql;
    const stats = await new OctokitGitHubClient('t', { octokit }).getDiffStats({ owner: 'acme', name: 'app' }, range(1, 250));

    expect(queries).toHaveLength(3);
    expect(stats).toHaveLength(250);
    expect(stats.find((s) => s.number === 7)).toEqual({ number: 7, additions: 7, deletions: 1, files_count: 2 });
  });

  it("keeps the rest of a query when one number doesn't resolve", async () => {
    const { octokit } = fakeOctokit([]);
    octokit.graphql = (async (query: string) => {
      throw Object.assign(new Error('Could not resolve to a PullRequest with the number of 3.'), {
        data: { repository: statsAnswer(query, [3]) },
      });
    }) as unknown as typeof octokit.graphql;
    const stats = await new OctokitGitHubClient('t', { octokit }).getDiffStats({ owner: 'acme', name: 'app' }, [1, 2, 3]);
    expect(stats.map((s) => s.number).sort()).toEqual([1, 2]);
  });

  it('falls back to a few REST calls when GraphQL refuses the token', async () => {
    const { octokit } = fakeOctokit([]);
    octokit.graphql = (async () => {
      throw Object.assign(new Error('Resource not accessible by personal access token'), { status: 403 });
    }) as unknown as typeof octokit.graphql;
    const warnings: { obj: unknown; msg: string | undefined }[] = [];
    const log = { warn: (obj: unknown, msg?: string) => warnings.push({ obj, msg }) };
    const stats = await new OctokitGitHubClient('t', { octokit, log }).getDiffStats({ owner: 'acme', name: 'app' }, range(1, 100));
    expect(stats).toHaveLength(30); // REST is capped per call; the next poll asks again
    expect(stats[0]).toMatchObject({ deletions: 1, files_count: 2 });
    // The switch is visible in the log, once per call, with the repo and how many PRs were due.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.msg).toMatch(/GraphQL refused the diff-stats query; fetching up to 30 PRs by REST/);
    expect(warnings[0]!.obj).toMatchObject({ repo: 'acme/app', prs: 100 });
  });
});
