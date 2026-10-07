import { describe, it, expect } from 'vitest';
import type { GitClient } from '@devdigest/shared';
import { RepoService } from '../src/modules/repos/service.js';
import type { RepoRecord } from '../src/modules/repos/domain.js';
import type { IndexTarget, JobQueue, NewRepo, RepoIndexing, RepoStore } from '../src/modules/repos/ports.js';
import { NotFoundError } from '../src/platform/errors.js';

class InMemoryRepos implements RepoStore {
  rows: RepoRecord[] = [];
  async list(workspaceId: string) {
    return this.rows.filter((r) => r.workspaceId === workspaceId);
  }
  async getById(workspaceId: string, id: string) {
    return this.rows.find((r) => r.workspaceId === workspaceId && r.id === id);
  }
  async insertIfAbsent(values: NewRepo) {
    const same = this.rows.find(
      (r) => r.workspaceId === values.workspaceId && r.fullName.toLowerCase() === values.fullName.toLowerCase(),
    );
    if (same) return { row: same, created: false };
    const row: RepoRecord = {
      ...values,
      id: `repo-${this.rows.length + 1}`,
      defaultBranch: 'main',
      clonePath: null,
      lastPolledAt: null,
    };
    this.rows.push(row);
    return { row, created: true };
  }
  async workspaceIdFor(repoId: string) {
    return this.rows.find((r) => r.id === repoId)?.workspaceId ?? null;
  }
  async updateClonePath(repoId: string, clonePath: string, defaultBranch?: string) {
    const row = this.rows.find((r) => r.id === repoId);
    if (row) {
      row.clonePath = clonePath;
      if (defaultBranch) row.defaultBranch = defaultBranch;
    }
  }
  async remove(workspaceId: string, id: string) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !(r.workspaceId === workspaceId && r.id === id));
    return this.rows.length < before;
  }
}

/** Records enqueued jobs; runs nothing until the test calls the handler. */
class RecordingJobs implements JobQueue {
  handlers = new Map<string, (payload: unknown) => Promise<void>>();
  enqueued: { kind: string; payload: unknown }[] = [];
  register(kind: string, handler: (payload: unknown) => Promise<void>) {
    this.handlers.set(kind, handler);
  }
  async enqueue(_workspaceId: string, kind: string, payload: unknown) {
    this.enqueued.push({ kind, payload });
  }
}

class RecordingIndexing implements RepoIndexing {
  requests: { what: 'index' | 'refresh'; repo: IndexTarget }[] = [];
  fail = false;
  async index(_ws: string, repo: IndexTarget) {
    if (this.fail) throw new Error('no indexer');
    this.requests.push({ what: 'index', repo });
  }
  async refresh(_ws: string, repo: IndexTarget) {
    if (this.fail) throw new Error('no indexer');
    this.requests.push({ what: 'refresh', repo });
  }
}

const git = {
  clone: async (repo: { owner: string; name: string }) => ({ path: `/clones/${repo.owner}/${repo.name}` }),
  defaultBranch: async () => 'master',
} as unknown as GitClient;

function setup() {
  const repos = new InMemoryRepos();
  const jobs = new RecordingJobs();
  const indexing = new RecordingIndexing();
  const service = new RepoService({ repos, jobs, git: () => git, indexing });
  service.registerCloneJobHandler();
  return { repos, jobs, indexing, service };
}

describe('RepoService', () => {
  it('adds a repo once and queues its clone; a second add of the same repo queues nothing', async () => {
    const { jobs, service } = setup();
    const first = await service.add('ws', 'u', 'https://github.com/Acme/App');
    expect(first.created).toBe(true);
    expect(first.repo.full_name).toBe('Acme/App');
    expect(jobs.enqueued).toEqual([
      { kind: 'clone', payload: { repoId: first.repo.id, owner: 'Acme', name: 'App', url: 'https://github.com/Acme/App.git' } },
    ]);

    const again = await service.add('ws', 'u', 'git@github.com:acme/app.git');
    expect(again).toEqual({ repo: first.repo, created: false });
    expect(jobs.enqueued).toHaveLength(1);
  });

  it('the clone job stores the path and asks for an index; a missing indexer does not fail the clone', async () => {
    const { repos, jobs, indexing, service } = setup();
    const { repo } = await service.add('ws', 'u', 'https://github.com/acme/app');
    await jobs.handlers.get('clone')!(jobs.enqueued[0]!.payload);
    expect(repos.rows[0]!.clonePath).toBe('/clones/acme/app');
    expect(repos.rows[0]!.defaultBranch).toBe('master');
    expect(indexing.requests).toEqual([{ what: 'index', repo: { repoId: repo.id, owner: 'acme', name: 'app' } }]);

    indexing.fail = true;
    await expect(jobs.handlers.get('clone')!(jobs.enqueued[0]!.payload)).resolves.toBeUndefined();
  });

  it('refresh re-clones and asks for an incremental index; unknown repos are 404', async () => {
    const { jobs, indexing, service } = setup();
    const { repo } = await service.add('ws', 'u', 'https://github.com/acme/app');
    expect(await service.refresh('ws', repo.id)).toEqual({ status: 'refreshing' });
    expect(jobs.enqueued.map((j) => j.kind)).toEqual(['clone', 'clone']);
    expect(indexing.requests.map((r) => r.what)).toEqual(['refresh']);

    await expect(service.refresh('other-ws', repo.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.remove('other-ws', repo.id)).rejects.toBeInstanceOf(NotFoundError);
    await service.remove('ws', repo.id);
    expect(await service.list('ws')).toEqual([]);
  });
});
