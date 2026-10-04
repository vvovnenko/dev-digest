/**
 * The API's JSON matches the shared Zod contracts the client types itself
 * with: each read route's response is parsed with its `@devdigest/shared`
 * schema, so a server change that drifts from the contract fails here, not in
 * the browser. Uses the seeded demo data (PR #482 with a review run).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  Agent,
  AgentSkillLink,
  AgentVersion,
  ConventionsState,
  PrDetail,
  PrMeta,
  Repo,
  ReviewRecord,
  RunSummary,
  RunTrace,
  SecretsStatus,
  Settings,
  Skill,
  SkillAgentUse,
  SkillVersion,
} from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitHubClient, MockSecretsProvider } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('API responses match the shared contracts (Testcontainers pg)', () => {
  let pg: PgFixture;
  let app: FastifyInstance;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    app = await buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: { github: new MockGitHubClient(), secrets: new MockSecretsProvider() },
    });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  /** GET `url`, expect 200, and parse the body with `schema` (throws with the Zod issues on drift). */
  const read = async <S extends z.ZodTypeAny>(url: string, schema: S): Promise<z.infer<S>> => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode, url).toBe(200);
    return schema.parse(res.json());
  };

  it('repos, PRs, PR detail, reviews, runs and a trace', async () => {
    const [repo] = await read('/repos', z.array(Repo));
    const pulls = await read(`/repos/${repo!.id}/pulls`, z.array(PrMeta));
    const pr = pulls.find((p) => p.number === 482)!;
    await read(`/pulls/${pr.id}`, PrDetail);
    const reviews = await read(`/pulls/${pr.id}/reviews`, z.array(ReviewRecord));
    expect(reviews.length).toBeGreaterThan(0);
    const runs = await read(`/pulls/${pr.id}/runs`, z.array(RunSummary));
    const withTrace = runs.find((r) => r.status !== 'running');
    if (withTrace) {
      const res = await app.inject({ method: 'GET', url: `/runs/${withTrace.run_id}/trace` });
      if (res.statusCode === 200) RunTrace.parse(res.json());
    }
  });

  it('list routes page with ?limit=&offset= and reject out-of-range values', async () => {
    const [repo] = await read('/repos', z.array(Repo));
    const pr = (await read(`/repos/${repo!.id}/pulls`, z.array(PrMeta))).find((p) => p.number === 482)!;
    const all = await read(`/pulls/${pr.id}/reviews`, z.array(ReviewRecord));
    expect(all.length).toBeGreaterThan(0);
    expect(await read(`/pulls/${pr.id}/reviews?limit=1`, z.array(ReviewRecord))).toEqual(all.slice(0, 1));
    expect(await read(`/pulls/${pr.id}/reviews?offset=${all.length}`, z.array(ReviewRecord))).toEqual([]);
    for (const q of ['limit=0', 'limit=1001', 'offset=-1']) {
      expect((await app.inject({ method: 'GET', url: `/pulls/${pr.id}/runs?${q}` })).statusCode, q).toBe(422);
    }
  });

  it('agents and their versions, settings and secrets status', async () => {
    const agents = await read('/agents', z.array(Agent));
    await read(`/agents/${agents[0]!.id}`, Agent);
    await read(`/agents/${agents[0]!.id}/versions`, z.array(AgentVersion));
    await read('/settings', Settings);
    await read('/settings/secrets-status', SecretsStatus);
  });

  it('skills, their versions and users, and an agent\'s skill links', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name: 'contract-skill', description: 'Apply always.', type: 'rubric', body: '# Rule' },
    });
    expect(created.statusCode).toBe(201);
    const skill = Skill.parse(created.json());
    await read('/skills', z.array(Skill));
    await read(`/skills/${skill.id}`, Skill);
    await read(`/skills/${skill.id}/versions`, z.array(SkillVersion));
    await read(`/skills/${skill.id}/agents`, z.array(SkillAgentUse));
    const agents = await read('/agents', z.array(Agent));
    expect(agents.every((a) => typeof a.skill_count === 'number')).toBe(true);
    await read(`/agents/${agents[0]!.id}/skills`, z.array(AgentSkillLink));
  });

  it("a repo's conventions (no scan yet)", async () => {
    const [repo] = await read('/repos', z.array(Repo));
    expect(await read(`/repos/${repo!.id}/conventions`, ConventionsState)).toEqual({
      scan: null,
      latest_scan: null,
      candidates: [],
    });
  });
});
