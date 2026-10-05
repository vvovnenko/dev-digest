import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { AgentsService } from '../src/modules/agents/service.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[agents-versions] Docker not available — skipping integration tests.');
}

/**
 * Agent version history — the read path over `agent_versions` snapshots that
 * `POST/PUT /agents` already write. Covers: a fresh agent has v1, a config edit
 * appends v2 (newest-first), single-version fetch, and the 404s (unknown agent,
 * unknown version, cross-workspace).
 */
d('GET /agents/:id/versions', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  const createBody = {
    name: 'Versioned Agent',
    provider: 'openai' as const,
    model: 'gpt-4o-mini',
    system_prompt: 'Review the diff.',
  };

  it('a new agent has exactly one version (v1) capturing its config', async () => {
    const app = await makeApp();
    const created = await app.inject({ method: 'POST', url: '/agents', payload: createBody });
    expect(created.statusCode).toBe(201);
    const agentId = created.json().id as string;

    const res = await app.inject({ method: 'GET', url: `/agents/${agentId}/versions` });
    expect(res.statusCode).toBe(200);
    const versions = res.json();
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      agent_id: agentId,
      version: 1,
      config: { provider: 'openai', model: 'gpt-4o-mini', system_prompt: 'Review the diff.' },
    });
    expect(typeof versions[0].created_at).toBe('string');
    await app.close();
  });

  it('a config edit appends a new version; list is newest-first', async () => {
    const app = await makeApp();
    const agentId = (
      await app.inject({ method: 'POST', url: '/agents', payload: createBody })
    ).json().id as string;

    // A config-affecting change (model) bumps the version → snapshot v2.
    const updated = await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}`,
      payload: { model: 'gpt-4o' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().version).toBe(2);

    const versions = (
      await app.inject({ method: 'GET', url: `/agents/${agentId}/versions` })
    ).json();
    expect(versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(versions[0].config.model).toBe('gpt-4o');
    expect(versions[1].config.model).toBe('gpt-4o-mini');
    await app.close();
  });

  it('toggling enabled does NOT create a new version', async () => {
    const app = await makeApp();
    const agentId = (
      await app.inject({ method: 'POST', url: '/agents', payload: createBody })
    ).json().id as string;

    await app.inject({ method: 'PUT', url: `/agents/${agentId}`, payload: { enabled: false } });

    const versions = (
      await app.inject({ method: 'GET', url: `/agents/${agentId}/versions` })
    ).json();
    expect(versions).toHaveLength(1);
    await app.close();
  });

  it('GET /agents/:id/versions/:version returns one snapshot', async () => {
    const app = await makeApp();
    const agentId = (
      await app.inject({ method: 'POST', url: '/agents', payload: createBody })
    ).json().id as string;
    await app.inject({ method: 'PUT', url: `/agents/${agentId}`, payload: { model: 'gpt-4o' } });

    const v1 = await app.inject({ method: 'GET', url: `/agents/${agentId}/versions/1` });
    expect(v1.statusCode).toBe(200);
    expect(v1.json()).toMatchObject({ version: 1, config: { model: 'gpt-4o-mini' } });
    await app.close();
  });

  it('404s for an unknown agent and an unknown version', async () => {
    const app = await makeApp();
    const agentId = (
      await app.inject({ method: 'POST', url: '/agents', payload: createBody })
    ).json().id as string;
    const ghost = '00000000-0000-0000-0000-000000000000';

    expect(
      (await app.inject({ method: 'GET', url: `/agents/${ghost}/versions` })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/agents/${ghost}/versions/1` })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/agents/${agentId}/versions/99` })).statusCode,
    ).toBe(404);
    await app.close();
  });

  it('a non-numeric :version is rejected at the edge (422, not 404)', async () => {
    const app = await makeApp();
    const agentId = (
      await app.inject({ method: 'POST', url: '/agents', payload: createBody })
    ).json().id as string;
    const res = await app.inject({ method: 'GET', url: `/agents/${agentId}/versions/abc` });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('versions are workspace-scoped: another tenant cannot read them', async () => {
    const { db } = pg.handle;
    // An agent that lives in a DIFFERENT workspace than the request context.
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other' }).returning();
    const repo = new AgentsRepository(db);
    const foreign = await repo.insert({
      workspaceId: otherWs!.id,
      name: 'Foreign',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'x',
    });

    const service = new AgentsService({
      agents: repo,
      llm: async () => {
        throw new Error('unused');
      },
    });
    const [defaultWsRow] = await db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));
    const defaultWs = defaultWsRow!.id;

    // Owner can read; a different workspace is denied (undefined → 404 at route).
    expect(await service.listVersions(otherWs!.id, foreign.id)).toHaveLength(1);
    expect(await service.listVersions(defaultWs, foreign.id)).toBeUndefined();
    expect(await service.getVersion(defaultWs, foreign.id, 1)).toBeUndefined();
  });

  describe('versioning under concurrency and skill changes', () => {
    const newSkill = async (name: string) => {
      const { db } = pg.handle;
      const [ws] = await db.select().from(t.workspaces).where(eq(t.workspaces.name, 'default'));
      const [skill] = await db
        .insert(t.skills)
        .values({ workspaceId: ws!.id, name, description: 'd', type: 'rubric', source: 'manual', body: 'b' })
        .returning();
      return skill!.id;
    };
    const versionsOf = async (app: Awaited<ReturnType<typeof makeApp>>, agentId: string) =>
      (await app.inject({ method: 'GET', url: `/agents/${agentId}/versions` })).json() as {
        version: number;
        config: { skills?: string[]; skill_links?: { skill_id: string; enabled: boolean }[]; model: string };
      }[];

    it('two concurrent config edits get two versions, each with its own snapshot', async () => {
      const app = await makeApp();
      const agentId = (await app.inject({ method: 'POST', url: '/agents', payload: createBody })).json().id as string;

      await Promise.all(
        ['model-a', 'model-b'].map((model) =>
          app.inject({ method: 'PUT', url: `/agents/${agentId}`, payload: { model } }),
        ),
      );

      const versions = await versionsOf(app, agentId);
      expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
      expect(new Set(versions.slice(0, 2).map((v) => v.config.model))).toEqual(new Set(['model-a', 'model-b']));
      await app.close();
    });

    it('changing skills creates a version whose snapshot lists them; the same list again does not', async () => {
      const app = await makeApp();
      const agentId = (await app.inject({ method: 'POST', url: '/agents', payload: createBody })).json().id as string;
      const [s1, s2] = [await newSkill('Rubric A'), await newSkill('Rubric B')];
      const post = (payload: object) => app.inject({ method: 'POST', url: `/agents/${agentId}/skills`, payload });

      expect((await post({ skill_ids: [s1, s2] })).statusCode).toBe(200);
      let versions = await versionsOf(app, agentId);
      expect(versions[0]).toMatchObject({ version: 2, config: { skills: [s1, s2] } });

      await post({ skill_ids: [s1, s2] });
      expect((await versionsOf(app, agentId))[0]!.version).toBe(2);

      // Moving a skill changes the order → a new version.
      await post({ skill_id: s1, order: 1 });
      versions = await versionsOf(app, agentId);
      expect(versions[0]).toMatchObject({ version: 3, config: { skills: [s2, s1] } });
      await app.close();
    });

    it('a failed skills update leaves the previous skills and version untouched', async () => {
      const app = await makeApp();
      const agentId = (await app.inject({ method: 'POST', url: '/agents', payload: createBody })).json().id as string;
      const s1 = await newSkill('Rubric C');
      await app.inject({ method: 'POST', url: `/agents/${agentId}/skills`, payload: { skill_ids: [s1] } });

      // The service refuses an unknown skill up front; the repository's own
      // transaction must still roll back if an insert fails inside it.
      const unknown = '00000000-0000-4000-8000-000000000000';
      const [ws] = await pg.handle.db
        .select({ id: t.workspaces.id })
        .from(t.workspaces)
        .where(eq(t.workspaces.name, 'default'));
      await expect(
        new AgentsRepository(pg.handle.db).replaceSkills(ws!.id, agentId, () => [
          { skillId: s1, enabled: true },
          { skillId: unknown, enabled: true },
        ]),
      ).rejects.toThrow();

      const links = (await app.inject({ method: 'GET', url: `/agents/${agentId}/skills` })).json() as { skill_id: string }[];
      expect(links.map((l) => l.skill_id)).toEqual([s1]);
      expect((await versionsOf(app, agentId))[0]!.version).toBe(2);
      await app.close();
    });

    it('links carry a per-agent flag: order and flags are versioned, only enabled ids reach `skills`', async () => {
      const app = await makeApp();
      const agentId = (await app.inject({ method: 'POST', url: '/agents', payload: createBody })).json().id as string;
      const [a, b, c] = [await newSkill('links-a'), await newSkill('links-b'), await newSkill('links-c')];
      const post = (payload: object) => app.inject({ method: 'POST', url: `/agents/${agentId}/skills`, payload });

      const res = await post({
        links: [
          { skill_id: c, enabled: true },
          { skill_id: a, enabled: false },
          { skill_id: b, enabled: true },
        ],
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([
        { agent_id: agentId, skill_id: c, order: 0, enabled: true },
        { agent_id: agentId, skill_id: a, order: 1, enabled: false },
        { agent_id: agentId, skill_id: b, order: 2, enabled: true },
      ]);
      let versions = await versionsOf(app, agentId);
      expect(versions[0]).toMatchObject({
        version: 2,
        config: {
          skills: [c, b],
          skill_links: [
            { skill_id: c, enabled: true },
            { skill_id: a, enabled: false },
            { skill_id: b, enabled: true },
          ],
        },
      });

      // The card count = enabled links, on the list and on the agent.
      const listed = (await app.inject({ method: 'GET', url: '/agents' })).json() as { id: string; skill_count: number }[];
      expect(listed.find((x) => x.id === agentId)!.skill_count).toBe(2);
      expect((await app.inject({ method: 'GET', url: `/agents/${agentId}` })).json().skill_count).toBe(2);

      // Flipping one flag is a change → a new version.
      await post({
        links: [
          { skill_id: c, enabled: true },
          { skill_id: a, enabled: true },
          { skill_id: b, enabled: true },
        ],
      });
      versions = await versionsOf(app, agentId);
      expect(versions[0]).toMatchObject({ version: 3, config: { skills: [c, a, b] } });

      // Linking one that is already linked (disabled) keeps its flag.
      await post({ links: [{ skill_id: a, enabled: false }] });
      await post({ skill_id: a, order: 0 });
      expect((await app.inject({ method: 'GET', url: `/agents/${agentId}/skills` })).json()).toEqual([
        { agent_id: agentId, skill_id: a, order: 0, enabled: false },
      ]);
      await app.close();
    });

    it('a skill listed twice in links is a 422 and changes nothing', async () => {
      const app = await makeApp();
      const agentId = (await app.inject({ method: 'POST', url: '/agents', payload: createBody })).json().id as string;
      const a = await newSkill('dup-a');
      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/skills`,
        payload: { links: [{ skill_id: a, enabled: true }, { skill_id: a, enabled: false }] },
      });
      expect(res.statusCode).toBe(422);
      expect((await versionsOf(app, agentId))[0]!.version).toBe(1);
      await app.close();
    });

    it('a skill from another workspace, or no skill at all, is a 404 and changes nothing', async () => {
      const app = await makeApp();
      const agentId = (await app.inject({ method: 'POST', url: '/agents', payload: createBody })).json().id as string;
      const [other] = await pg.handle.db.insert(t.workspaces).values({ name: `other-${Date.now()}` }).returning();
      const [foreign] = await pg.handle.db
        .insert(t.skills)
        .values({ workspaceId: other!.id, name: 'Foreign', description: 'd', type: 'rubric', source: 'manual', body: 'b' })
        .returning();

      for (const payload of [{ skill_ids: [foreign!.id] }, { skill_id: '00000000-0000-4000-8000-000000000000' }]) {
        const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/skills`, payload });
        expect(res.statusCode).toBe(404);
      }
      expect((await app.inject({ method: 'GET', url: `/agents/${agentId}/skills` })).json()).toEqual([]);
      expect((await versionsOf(app, agentId))[0]!.version).toBe(1);
      await app.close();
    });
  });

  it('GET /agents lists agents oldest first, whatever order their rows are stored in', async () => {
    const { db } = pg.handle;
    const [ws] = await db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));
    const row = (name: string, createdAt: string) => ({
      workspaceId: ws!.id,
      name,
      provider: 'openai' as const,
      model: 'gpt-4o-mini',
      systemPrompt: 'x',
      createdAt: new Date(createdAt),
    });
    // Stored newer-first. Without an ORDER BY the list follows storage order, which an
    // update also changes (a new row version) — the agents list reshuffled after edits.
    const [newer] = await db.insert(t.agents).values(row('Order Newer', '2000-01-02')).returning();
    const [older] = await db.insert(t.agents).values(row('Order Older', '2000-01-01')).returning();

    const app = await makeApp();
    const ids = (await app.inject({ method: 'GET', url: '/agents' })).json().map((a: { id: string }) => a.id);
    expect(ids.slice(0, 2)).toEqual([older!.id, newer!.id]);
    await app.close();
  });
});
