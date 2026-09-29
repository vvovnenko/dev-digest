import { describe, it, expect } from 'vitest';
import type { GitHubClient, ListPullsOptions, PrDetail, PrDiffStats, PrMeta } from '@devdigest/shared';
import { PullsService } from '../src/modules/pulls/service.js';
import { STATS_PER_POLL, PollingService } from '../src/modules/polling/service.js';
import type { PrCommitRecord, PrFileRecord, PullRecord, PullRollup } from '../src/modules/pulls/domain.js';
import type { PullStore } from '../src/modules/pulls/ports.js';
import { NotFoundError } from '../src/platform/errors.js';

const REPO = { id: 'r1', owner: 'acme', name: 'app' };
const PAGE = { limit: 100, offset: 0 };

function pull(n: number, over: Partial<PullRecord> = {}): PullRecord {
  return {
    id: `pr-${n}`,
    workspaceId: 'ws',
    repoId: REPO.id,
    number: n,
    title: `PR ${n}`,
    author: 'dev',
    branch: 'feat',
    base: 'main',
    headSha: 'sha',
    lastReviewedSha: null,
    additions: 0,
    deletions: 0,
    filesCount: 0,
    status: 'open',
    body: null,
    openedAt: null,
    updatedAt: null,
    ...over,
  };
}

class InMemoryPulls implements PullStore {
  pulls: PullRecord[] = [];
  files: PrFileRecord[] = [{ path: 'a.ts', additions: 1, deletions: 0, patch: '@@' }];
  commits: PrCommitRecord[] = [];
  rollupByPr = new Map<string, PullRollup>();
  polledAt?: Date;
  watermark: Date | null = null;
  async repoInWorkspace(ws: string, repoId: string) {
    return ws === 'ws' && repoId === REPO.id ? REPO : undefined;
  }
  async pullInWorkspace(ws: string, prId: string) {
    const p = this.pulls.find((x) => x.id === prId && x.workspaceId === ws);
    return p ? { pull: p, repo: REPO } : undefined;
  }
  async upsertFromGitHub(_ws: string, _repoId: string, pulls: PrMeta[]) {
    for (const m of pulls) if (!this.pulls.some((p) => p.number === m.number)) this.pulls.push(pull(m.number));
    return pulls.length;
  }
  async listForRepo() {
    return this.pulls.map((p) => ({ ...p }));
  }
  async lackingDiffStats(_repoId: string, limit: number) {
    return this.pulls
      .filter((p) => p.additions === 0 && p.deletions === 0 && p.filesCount === 0)
      .slice(0, limit)
      .map(({ id, number }) => ({ id, number }));
  }
  async saveDiffStats(_repoId: string, stats: PrDiffStats[]) {
    for (const s of stats) {
      const row = this.pulls.find((p) => p.number === s.number);
      if (row) Object.assign(row, { additions: s.additions, deletions: s.deletions, filesCount: s.files_count });
    }
  }
  async syncWatermark() {
    return this.watermark;
  }
  async rollups() {
    return this.rollupByPr;
  }
  async replaceDetail() {}
  async storedDetail() {
    return { files: this.files, commits: this.commits };
  }
  async markPolled(_repoId: string, at: Date, syncedThrough?: Date) {
    this.polledAt = at;
    if (syncedThrough) this.watermark = syncedThrough;
  }
}

/**
 * A GitHub that reports `count` PRs — PR n updated at hour n, most recent first —
 * and records list options, stats batches and detail fetches.
 */
function fakeGitHub(count: number) {
  const calls = { details: 0, lists: [] as ListPullsOptions[], stats: [] as number[][] };
  const updatedAt = (n: number) => new Date(Date.UTC(2026, 8, 1, n)).toISOString();
  const meta = (n: number) => ({ number: n, title: `PR ${n}`, author: 'dev', branch: 'feat', base: 'main', head_sha: 'sha', additions: 0, deletions: 0, files_count: 0, status: 'open', updated_at: updatedAt(n) }) as PrMeta;
  const all = () => Array.from({ length: count }, (_, i) => meta(count - i));
  const gh = {
    listPullRequests: async (_repo: unknown, opts: ListPullsOptions = {}) => {
      calls.lists.push(opts);
      const since = opts.updatedSince ? Date.parse(opts.updatedSince) : null;
      return since === null ? all() : all().filter((p) => Date.parse(p.updated_at!) >= since);
    },
    getDiffStats: async (_repo: unknown, numbers: number[]): Promise<PrDiffStats[]> => {
      calls.stats.push(numbers);
      return numbers.map((n) => ({ number: n, additions: 5, deletions: 1, files_count: 2 }));
    },
    getPullRequest: async (_repo: unknown, n: number): Promise<PrDetail> => {
      calls.details++;
      return { ...meta(n), additions: 5, deletions: 1, files_count: 2, body: 'b', files: [], commits: [] } as PrDetail;
    },
    listReviewComments: async () => {
      throw new Error('offline');
    },
  } as unknown as GitHubClient;
  return { gh, calls };
}

const offline = async (): Promise<GitHubClient> => {
  throw new Error('GITHUB_TOKEN is not configured');
};
const silent = { warn: () => undefined };

describe('PullsService', () => {
  it('lists what is stored without calling GitHub (the list is polled every minute)', async () => {
    const store = new InMemoryPulls();
    store.pulls.push(pull(1), pull(2));
    const { gh, calls } = fakeGitHub(5);
    let githubBuilt = 0;
    const service = new PullsService({ pulls: store, github: async () => (githubBuilt++, gh), log: silent, now: () => 0 });

    const list = await service.listForRepo('ws', REPO.id, PAGE);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ status: 'needs_review', score: null, cost_usd: null, findings_by_severity: null });
    expect(githubBuilt).toBe(0);
    expect(calls.details).toBe(0);
  });

  it('serves what is stored when GitHub is unreachable, and 404s outside the workspace', async () => {
    const store = new InMemoryPulls();
    store.pulls.push(pull(7, { additions: 3 }));
    store.rollupByPr.set('pr-7', { score: 88, findingsBySeverity: { CRITICAL: 0, WARNING: 1, SUGGESTION: 0 }, costUsd: 0.01 });
    const service = new PullsService({ pulls: store, github: offline, log: silent });

    expect(await service.listForRepo('ws', REPO.id, PAGE)).toMatchObject([{ number: 7, score: 88, cost_usd: 0.01 }]);
    expect(await service.detail('ws', 'pr-7')).toMatchObject({ number: 7, files: [{ path: 'a.ts' }] });
    expect(await service.comments('ws', 'pr-7')).toEqual([]);
    await expect(service.addComment('ws', 'pr-7', { path: 'a.ts', line: 1, body: 'x' })).rejects.toMatchObject({
      code: 'github_unavailable',
    });
    await expect(service.listForRepo('other', REPO.id, PAGE)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.detail('other', 'pr-7')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('PollingService', () => {
  it('reads everything first, then only what changed since the newest update it stored', async () => {
    const store = new InMemoryPulls();
    const { gh, calls } = fakeGitHub(5);
    const service = new PollingService({ pulls: store, github: async () => gh, log: silent });

    await service.poll('ws', REPO.id);
    expect(calls.lists).toEqual([{}]); // no watermark yet: every page
    expect(store.pulls).toHaveLength(5);
    expect(store.watermark?.toISOString()).toBe('2026-09-01T05:00:00.000Z');

    await service.poll('ws', REPO.id);
    expect(calls.lists[1]).toEqual({ updatedSince: '2026-09-01T05:00:00.000Z' });
  });

  it('refreshes the stats of the PRs it saw change, then of those still without, capped per poll', async () => {
    const store = new InMemoryPulls();
    const { gh, calls } = fakeGitHub(STATS_PER_POLL + 20);
    const service = new PollingService({ pulls: store, github: async () => gh, log: silent });

    await service.poll('ws', REPO.id);
    expect(calls.stats).toHaveLength(1); // one call; the adapter batches it
    expect(calls.stats[0]).toHaveLength(STATS_PER_POLL);
    expect(calls.stats[0]![0]).toBe(STATS_PER_POLL + 20); // most recently updated first
    expect(calls.details).toBe(0); // no per-PR detail fetches
    expect(store.pulls.filter((p) => p.additions === 5)).toHaveLength(STATS_PER_POLL);

    await service.poll('ws', REPO.id); // saw only the newest again; the 20 left get filled now
    expect(store.pulls.filter((p) => p.additions === 5)).toHaveLength(STATS_PER_POLL + 20);
  });

  it('a stats failure is logged and the poll still imports and moves the watermark', async () => {
    const store = new InMemoryPulls();
    const { gh } = fakeGitHub(3);
    gh.getDiffStats = async () => {
      throw new Error('GraphQL down');
    };
    const warned: unknown[] = [];
    const service = new PollingService({ pulls: store, github: async () => gh, log: { warn: (o) => warned.push(o) } });

    expect(await service.poll('ws', REPO.id)).toMatchObject({ synced: 3 });
    expect(warned).toHaveLength(1);
    expect(store.watermark).not.toBeNull();
  });

  it('syncs the list and stamps the repo, and needs a GitHub token', async () => {
    const store = new InMemoryPulls();
    const at = new Date('2026-09-28T12:00:00Z');
    const { gh } = fakeGitHub(2);
    expect(await new PollingService({ pulls: store, github: async () => gh, now: () => at }).poll('ws', REPO.id)).toEqual({
      synced: 2,
      reviewTriggered: false,
    });
    expect(store.polledAt).toBe(at);
    await expect(new PollingService({ pulls: store, github: offline }).poll('ws', REPO.id)).rejects.toThrow(/GITHUB_TOKEN/);
  });
});
