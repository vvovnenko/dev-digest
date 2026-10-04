import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { count, eq } from 'drizzle-orm';
import { zipSync, strToU8 } from 'fflate';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import { SkillsRepository } from '../src/modules/skills/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skills] Docker not available — skipping integration tests.');
}

/**
 * Skills Lab over a real Postgres: CRUD, the unique name (409), version
 * snapshots + restore, the agent-usage counts, workspace scoping, the delete
 * cascade, and that the import preview never writes.
 */
d('/skills (Testcontainers pg)', () => {
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
      overrides: { git: new MockGitClient(), github: new MockGitHubClient(), secrets: new MockSecretsProvider() },
    });
  }

  type App = Awaited<ReturnType<typeof makeApp>>;
  const createSkill = (app: App, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/skills', payload });
  const createAgent = async (app: App, name: string) =>
    (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name, provider: 'openai', model: 'gpt-4o-mini', system_prompt: 'Review.' },
      })
    ).json().id as string;

  it('creates, reads, lists, edits and versions a skill', async () => {
    const app = await makeApp();
    const created = await createSkill(app, {
      name: 'it-rubric',
      description: 'Apply to every diff.',
      type: 'rubric',
      body: '# Rubric\nOne.',
    });
    expect(created.statusCode).toBe(201);
    const skill = created.json();
    expect(skill).toMatchObject({ name: 'it-rubric', type: 'rubric', source: 'manual', version: 1, enabled: true, agent_count: 0 });

    expect((await app.inject({ method: 'GET', url: `/skills/${skill.id}` })).json().name).toBe('it-rubric');
    const listed = (await app.inject({ method: 'GET', url: '/skills' })).json() as { id: string }[];
    expect(listed.some((s) => s.id === skill.id)).toBe(true);

    const edited = await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}`,
      payload: { body: '# Rubric\nTwo.', description: 'Apply to every PR.' },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ version: 2, body: '# Rubric\nTwo.' });

    // Enabled alone: no new version.
    const off = await app.inject({ method: 'PUT', url: `/skills/${skill.id}`, payload: { enabled: false } });
    expect(off.json()).toMatchObject({ version: 2, enabled: false });

    const versions = (await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions` })).json();
    expect(versions.map((v: { version: number; note: string }) => [v.version, v.note])).toEqual([
      [2, 'Edited body, description'],
      [1, 'Created'],
    ]);
    expect(versions[1]).toMatchObject({ name: 'it-rubric', type: 'rubric', body: '# Rubric\nOne.' });
    expect(typeof versions[0].created_at).toBe('string');
    await app.close();
  });

  it('restore adds a version with the old content', async () => {
    const app = await makeApp();
    const id = (await createSkill(app, { name: 'it-restore', body: 'one' })).json().id as string;
    await app.inject({ method: 'PUT', url: `/skills/${id}`, payload: { body: 'two' } });

    const restored = await app.inject({ method: 'POST', url: `/skills/${id}/versions/1/restore` });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ version: 3, body: 'one' });
    const versions = (await app.inject({ method: 'GET', url: `/skills/${id}/versions` })).json();
    expect(versions[0]).toMatchObject({ version: 3, note: 'Restored v1' });

    expect((await app.inject({ method: 'POST', url: `/skills/${id}/versions/9/restore` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/skills/${id}/versions/x/restore` })).statusCode).toBe(422);
    await app.close();
  });

  it('a taken name is a 409 on create, rename and restore', async () => {
    const app = await makeApp();
    await createSkill(app, { name: 'it-taken', body: 'x' });
    const dup = await createSkill(app, { name: 'it-taken', body: 'y' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toMatchObject({ code: 'conflict', details: { field: 'name' } });

    const other = (await createSkill(app, { name: 'it-other', body: 'x' })).json().id as string;
    expect(
      (await app.inject({ method: 'PUT', url: `/skills/${other}`, payload: { name: 'it-taken' } })).statusCode,
    ).toBe(409);

    // Rename it-other → it-free, free "it-other", let something else take it, then restore v1 (name it-other).
    await app.inject({ method: 'PUT', url: `/skills/${other}`, payload: { name: 'it-free' } });
    await createSkill(app, { name: 'it-other', body: 'z' });
    expect((await app.inject({ method: 'POST', url: `/skills/${other}/versions/1/restore` })).statusCode).toBe(409);
    await app.close();
  });

  it('rejects a bad name or an empty body at the edge (422)', async () => {
    const app = await makeApp();
    expect((await createSkill(app, { name: 'Not A Slug', body: 'x' })).statusCode).toBe(422);
    expect((await createSkill(app, { name: 'it-empty', body: '   ' })).statusCode).toBe(422);
    await app.close();
  });

  it('counts and lists the agents that have it enabled; delete cascades their links', async () => {
    const app = await makeApp();
    const skillId = (await createSkill(app, { name: 'it-used', body: 'x' })).json().id as string;
    const a1 = await createAgent(app, 'IT Agent One');
    const a2 = await createAgent(app, 'IT Agent Two');
    await app.inject({ method: 'POST', url: `/agents/${a1}/skills`, payload: { links: [{ skill_id: skillId, enabled: true }] } });
    await app.inject({ method: 'POST', url: `/agents/${a2}/skills`, payload: { links: [{ skill_id: skillId, enabled: false }] } });

    expect((await app.inject({ method: 'GET', url: `/skills/${skillId}` })).json().agent_count).toBe(1);
    const listed = (await app.inject({ method: 'GET', url: '/skills' })).json() as { id: string; agent_count: number }[];
    expect(listed.find((s) => s.id === skillId)!.agent_count).toBe(1);
    expect((await app.inject({ method: 'GET', url: `/skills/${skillId}/agents` })).json()).toEqual([
      { agent_id: a1, agent_name: 'IT Agent One', agent_enabled: true, order: 0 },
    ]);

    expect((await app.inject({ method: 'DELETE', url: `/skills/${skillId}` })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: 'GET', url: `/skills/${skillId}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/agents/${a1}/skills` })).json()).toEqual([]);
    const [versions] = await pg.handle.db
      .select({ n: count() })
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId));
    expect(versions!.n).toBe(0);
    await app.close();
  });

  it("answers 404 for another workspace's skill on every route", async () => {
    const app = await makeApp();
    const [ws] = await pg.handle.db.insert(t.workspaces).values({ name: `skills-other-${Date.now()}` }).returning();
    const foreign = await new SkillsRepository(pg.handle.db).insert(
      { workspaceId: ws!.id, name: 'foreign', description: '', type: 'custom', body: 'x', source: 'manual', enabled: true },
      'Created',
    );
    if (foreign === 'name_taken') throw new Error('unexpected');
    const id = foreign.id;
    const calls = [
      { method: 'GET', url: `/skills/${id}` },
      { method: 'PUT', url: `/skills/${id}`, payload: { body: 'y' } },
      { method: 'DELETE', url: `/skills/${id}` },
      { method: 'GET', url: `/skills/${id}/versions` },
      { method: 'POST', url: `/skills/${id}/versions/1/restore` },
      { method: 'GET', url: `/skills/${id}/agents` },
    ] as const;
    for (const call of calls) {
      const res = await app.inject(call);
      expect(res.statusCode, `${call.method} ${call.url}`).toBe(404);
    }
    const listed = (await app.inject({ method: 'GET', url: '/skills' })).json() as { id: string }[];
    expect(listed.some((s) => s.id === id)).toBe(false);
    // Untouched in its own workspace.
    const [row] = await pg.handle.db.select().from(t.skills).where(eq(t.skills.id, id));
    expect(row).toMatchObject({ body: 'x', version: 1 });
    await app.close();
  });

  it('the import preview parses the upload and writes nothing', async () => {
    const app = await makeApp();
    await createSkill(app, { name: 'flaky-it', body: 'x' });
    const zip = zipSync({
      'flaky-it/SKILL.md': strToU8('---\nname: flaky-it\ndescription: Apply to tests.\nallowed-tools: Bash\n---\n# Flaky\nNo sleeps.'),
      'flaky-it/scripts/find-sleeps.sh': strToU8('#!/bin/sh\necho never run\n'),
    });
    const rows = async () => (await pg.handle.db.select({ n: count() }).from(t.skills))[0]!.n;
    const before = await rows();
    const res = await app.inject({
      method: 'POST',
      url: '/skills/import/preview',
      payload: { filename: 'flaky-it.zip', content_base64: Buffer.from(zip).toString('base64') },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      draft: { name: 'flaky-it', description: 'Apply to tests.', type: 'custom', body: '# Flaky\nNo sleeps.' },
      source_file: 'flaky-it/SKILL.md',
      skipped: [{ path: 'flaky-it/scripts/find-sleeps.sh', reason: 'script' }],
      name_taken: true,
    });
    expect(res.json().warnings).toContainEqual({ code: 'unknown_frontmatter_key', detail: 'allowed-tools' });
    expect(await rows()).toBe(before);

    // Confirming = a normal create with source 'imported' → note "Imported from <file>".
    const saved = await createSkill(app, {
      name: 'flaky-it-2',
      description: 'Apply to tests.',
      body: '# Flaky\nNo sleeps.',
      source: 'imported',
      imported_from: 'flaky-it.zip',
    });
    expect(saved.json().source).toBe('imported');
    const versions = (await app.inject({ method: 'GET', url: `/skills/${saved.json().id}/versions` })).json();
    expect(versions[0].note).toBe('Imported from flaky-it.zip');
    await app.close();
  });

  it('refuses an unreadable or oversized upload (422)', async () => {
    const app = await makeApp();
    const post = (filename: string, content_base64: string) =>
      app.inject({ method: 'POST', url: '/skills/import/preview', payload: { filename, content_base64 } });
    expect((await post('x.zip', Buffer.from('not a zip').toString('base64'))).statusCode).toBe(422);
    expect((await post('x.exe', Buffer.from('MZ').toString('base64'))).statusCode).toBe(422);
    // Over the contract's base64 cap (≈ 512 KiB raw).
    const big = Buffer.alloc(600 * 1024, 65).toString('base64');
    expect((await post('big.md', big)).statusCode).toBe(422);
    await app.close();
  });
});
