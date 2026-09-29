import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { PullsRepository } from '../src/modules/pulls/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn(
    '[integration] Docker not available — skipping Testcontainers integration tests.',
  );
}

d('Testcontainers: pg + pgvector', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('migrations applied: every table exists', async () => {
    const rows = await pg.handle.sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM information_schema.tables
      WHERE table_schema = 'public'`;
    // 35 domain tables + drizzle migration bookkeeping
    expect(rows[0]!.count).toBeGreaterThanOrEqual(35);
  });

  it('pgvector extension is enabled', async () => {
    const rows = await pg.handle.sql<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'vector'`;
    expect(rows).toHaveLength(1);
  });

  it('vector insert + similarity query round-trips', async () => {
    const { db } = pg.handle;
    const { workspaceId } = await seed(db);
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'v', name: 'vec', fullName: 'v/vec' })
      .returning();
    const vec = Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0));
    await db.insert(t.codeChunks).values({
      workspaceId,
      repoId: repo!.id,
      path: 'a.ts',
      content: 'hello',
      embedding: vec,
      source: 'code',
    });
    // cosine distance query against the same vector → distance ~0
    const literal = `[${vec.join(',')}]`;
    const rows = await pg.handle.sql<{ dist: number }[]>`
      SELECT embedding <=> ${literal}::vector AS dist
      FROM code_chunks WHERE repo_id = ${repo!.id}`;
    expect(rows[0]!.dist).toBeLessThan(0.0001);
  });

  it('seed is idempotent (re-run does not duplicate workspace)', async () => {
    await seed(pg.handle.db);
    await seed(pg.handle.db);
    const ws = await pg.handle.db.select().from(t.workspaces);
    expect(ws.filter((w) => w.name === 'default')).toHaveLength(1);
  });
});

d('Testcontainers: DB-backed routes via app.inject', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('POST /repos persists + enqueues a clone (mock git) and GET /repos lists it', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const git = new MockGitClient();
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git, github: new MockGitHubClient() },
    });

    const create = await app.inject({
      method: 'POST',
      url: '/repos',
      payload: { url: 'https://github.com/acme/widgets' },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().full_name).toBe('acme/widgets');

    await app.container.jobs.onIdle();
    expect(git.cloned.some((c) => c.repo.name === 'widgets')).toBe(true);

    const list = await app.inject({ method: 'GET', url: '/repos' });
    expect(list.json().some((r: { full_name: string }) => r.full_name === 'acme/widgets')).toBe(
      true,
    );
    await app.close();
  });

  it('POST /repos/:id/poll imports PRs (mock GitHub) idempotently; GET /repos/:id/pulls only reads', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const polled = {
      number: 900,
      title: 'Polled PR',
      author: 'dev',
      branch: 'feat/polled',
      base: 'main',
      head_sha: 'h900',
      additions: 0,
      deletions: 0,
      files_count: 0,
      status: 'open',
      opened_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-01T03:00:00Z',
    } as const;
    const github = new MockGitHubClient({ pulls: [polled] });
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github },
    });
    const repos = await app.inject({ method: 'GET', url: '/repos' });
    const repoId = repos.json()[0]!.id;
    const list = async () =>
      (await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` })).json() as { number: number; additions: number }[];

    expect((await list()).some((p) => p.number === 900)).toBe(false); // a read never imports
    expect((await app.inject({ method: 'POST', url: `/repos/${repoId}/poll` })).json()).toMatchObject({ synced: 1 });
    const first = await list();
    // Imported, and its diff stats filled in from the batched stats call (the list payload has none).
    expect(first.find((p) => p.number === 900)).toMatchObject({ additions: expect.any(Number) });
    expect(first.find((p) => p.number === 900)!.additions).toBeGreaterThan(0);
    expect(github.statsCalls[0]).toContain(900);
    // The watermark is the newest update imported; the next poll reads GitHub only down to it.
    const [row] = await pg.handle.db.select().from(t.repos).where(eq(t.repos.id, repoId));
    expect(row!.pullsSyncedThrough?.toISOString()).toBe('2026-06-01T03:00:00.000Z');
    // import again → still idempotent (unique repo_id+number), and incremental
    await app.inject({ method: 'POST', url: `/repos/${repoId}/poll` });
    expect(github.listCalls).toEqual([{}, { updatedSince: '2026-06-01T03:00:00.000Z' }]);
    expect((await list()).length).toBe(first.length);
    await app.close();
  });

  it('POST /repos/:id/poll syncs PR list and does NOT trigger a review', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
    const repoId = (await app.inject({ method: 'GET', url: '/repos' })).json()[0]!.id;
    const poll = await app.inject({ method: 'POST', url: `/repos/${repoId}/poll` });
    expect(poll.json().reviewTriggered).toBe(false);
    expect(poll.json().synced).toBeGreaterThan(0);
    await app.close();
  });

  it('a poll of thousands of PRs is chunked into one transaction, idempotently', async () => {
    const { db } = pg.handle;
    const [ws] = await db.select().from(t.workspaces);
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId: ws!.id, owner: 'big', name: 'monorepo', fullName: 'big/monorepo' })
      .returning();
    // 5 000 rows × 14 columns is past Postgres's 65 535 parameters for one statement.
    const pulls = Array.from({ length: 5000 }, (_, i) => ({
      number: i + 1,
      title: `PR ${i + 1}`,
      author: 'dev',
      branch: 'feat',
      base: 'main',
      head_sha: `h${i + 1}`,
      additions: 0,
      deletions: 0,
      files_count: 0,
      status: 'open' as const,
      opened_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-01T03:00:00Z',
    }));
    const store = new PullsRepository(db);
    expect(await store.upsertFromGitHub(ws!.id, repo!.id, [...pulls, pulls[0]!])).toBe(5000); // a repeat is kept once
    expect(await store.upsertFromGitHub(ws!.id, repo!.id, pulls)).toBe(5000);
    const rows = await db.select({ id: t.pullRequests.id }).from(t.pullRequests).where(eq(t.pullRequests.repoId, repo!.id));
    expect(rows).toHaveLength(5000);
  });

  describe('wave 1: consistent PR and repo writes', () => {
    const appWith = (github = new MockGitHubClient()) =>
      buildApp({
        config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
        db: pg.handle.db,
        overrides: { git: new MockGitClient(), github },
      });

    it('a repo is one repo whatever the letter case, even when added twice at once', async () => {
      const app = await appWith();
      const [a, b] = await Promise.all(
        ['https://github.com/Case/Repo', 'https://github.com/case/repo'].map((url) =>
          app.inject({ method: 'POST', url: '/repos', payload: { url } }),
        ),
      );
      expect([a!.statusCode, b!.statusCode].sort()).toEqual([200, 201]);
      expect(a!.json().id).toBe(b!.json().id);
      await app.close();
    });

    it("the poll keeps a PR's base and opened_at in step with GitHub", async () => {
      const pull = {
        number: 900, title: 't', author: 'dev', branch: 'feat', base: 'main', head_sha: 'h1',
        additions: 0, deletions: 0, files_count: 0, status: 'open' as const,
        opened_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-02T00:00:00Z',
      };
      let app = await appWith(new MockGitHubClient({ pulls: [pull] }));
      const repoId = (await app.inject({ method: 'GET', url: '/repos' })).json()[0]!.id as string;
      await app.inject({ method: 'POST', url: `/repos/${repoId}/poll` });
      await app.close();

      // Retargeted to another base — which bumps its updated_at, so the incremental poll reads it.
      app = await appWith(
        new MockGitHubClient({ pulls: [{ ...pull, base: 'release', head_sha: 'h2', updated_at: '2026-07-01T00:00:00Z' }] }),
      );
      await app.inject({ method: 'POST', url: `/repos/${repoId}/poll` });
      const [row] = await pg.handle.db
        .select()
        .from(t.pullRequests)
        .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 900)));
      expect(row!.base).toBe('release');
      expect(row!.headSha).toBe('h2');
      expect(row!.openedAt?.toISOString()).toBe('2026-05-01T00:00:00.000Z');
      await app.close();
    });

    it('concurrent PR detail refreshes never duplicate files or commits', async () => {
      const app = await appWith();
      const repoId = (await app.inject({ method: 'GET', url: '/repos' })).json()[0]!.id as string;
      const pulls = (await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` })).json();
      const prId = pulls[0]!.id as string;

      const results = await Promise.all(
        Array.from({ length: 4 }, () => app.inject({ method: 'GET', url: `/pulls/${prId}` })),
      );
      expect(results.every((r) => r.statusCode === 200)).toBe(true);
      const files = await pg.handle.db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
      const commits = await pg.handle.db.select().from(t.prCommits).where(eq(t.prCommits.prId, prId));
      expect(files).toHaveLength(1);
      expect(commits).toHaveLength(1);
      await app.close();
    });
  });

  it('/health/ready is ready on a migrated DB, and 503 while a migration is pending', async () => {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({ config, db: pg.handle.db });
    expect((await app.inject({ method: 'GET', url: '/health/ready' })).json()).toEqual({ ready: true });

    // Forget the newest migration, as if the build shipped one the DB hasn't run.
    const [last] = await pg.handle.sql<{ id: number; hash: string; created_at: string }[]>`
      SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`;
    await pg.handle.sql`DELETE FROM drizzle.__drizzle_migrations WHERE id = ${last!.id}`;
    try {
      const res = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ ready: false, reason: 'migrations_pending', pending: 1 });
    } finally {
      await pg.handle.sql`INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at)
        VALUES (${last!.id}, ${last!.hash}, ${last!.created_at})`;
      await app.close();
    }
  });
});
