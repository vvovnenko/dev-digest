/**
 * Ids from another workspace are not found: runs, repos and PRs are addressed
 * by id, so every route must check the id belongs to the request's workspace
 * (one workspace today, but the schema is multi-tenant).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('tenant scoping (Testcontainers pg)', () => {
  let pg: PgFixture;
  let foreign: { repoId: string; prId: string; runId: string };

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const { db } = pg.handle;
    const [ws] = await db.insert(t.workspaces).values({ name: 'someone-else' }).returning();
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId: ws!.id, owner: 'other', name: 'app', fullName: 'other/app' })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws!.id,
        repoId: repo!.id,
        number: 1,
        title: 't',
        author: 'a',
        branch: 'b',
        base: 'main',
        headSha: 'h',
        status: 'open',
      })
      .returning();
    const [run] = await db
      .insert(t.agentRuns)
      .values({ workspaceId: ws!.id, prId: pr!.id, status: 'running', source: 'local' })
      .returning();
    await db.insert(t.runTraces).values({ runId: run!.id, trace: { log: [] } as never });
    foreign = { repoId: repo!.id, prId: pr!.id, runId: run!.id };
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it("answers 404 for another workspace's runs, repos and PRs, and changes nothing", async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { github: new MockGitHubClient(), secrets: new MockSecretsProvider() },
    });
    const { runId, repoId, prId } = foreign;
    // Boot reaps every `running` run (single-instance assumption); make it live again.
    await pg.handle.db.update(t.agentRuns).set({ status: 'running' }).where(eq(t.agentRuns.id, runId));
    const calls = [
      { method: 'GET', url: `/runs/${runId}/trace` },
      { method: 'GET', url: `/runs/${runId}/events` },
      { method: 'POST', url: `/runs/${runId}/cancel` },
      { method: 'GET', url: `/repos/${repoId}/index-state` },
      { method: 'POST', url: `/repos/${repoId}/resync` },
      { method: 'GET', url: `/repos/${repoId}/pulls` },
      { method: 'POST', url: `/repos/${repoId}/poll` },
      { method: 'POST', url: `/repos/${repoId}/refresh` },
      { method: 'GET', url: `/pulls/${prId}` },
      { method: 'GET', url: `/pulls/${prId}/reviews` },
      { method: 'GET', url: `/pulls/${prId}/comments` },
    ] as const;
    for (const call of calls) {
      const res = await app.inject(call);
      expect({ ...call, status: res.statusCode }).toEqual({ ...call, status: 404 });
    }
    expect((await app.inject({ method: 'DELETE', url: `/runs/${runId}` })).json()).toEqual({ ok: false });

    const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    expect(run!.status).toBe('running');
    await app.close();
  });
});
