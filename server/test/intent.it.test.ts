import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  PrIntentState,
  type LLMProvider,
  type StructuredRequest,
  type StructuredResult,
} from '@devdigest/shared';
import { LlmCallError } from '@devdigest/reviewer-core';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider, MockSecretsProvider } from '../src/adapters/mocks.js';
import { ConfigError } from '../src/platform/errors.js';
import { INTENT_SCHEMA_NAME } from '../src/modules/intent/constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[intent] Docker not available — skipping integration tests.');
}

const FIXTURE = {
  summary: 'Adds rate limiting to the public API.',
  in_scope: ['src/config.ts'],
  out_of_scope: ['authentication'],
  confidence: 'high',
  missing_context: [],
};
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@ export const config = {
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** The mock model, able to hold its calls — to look at an attempt while it runs. */
class GatedLlm extends MockLLMProvider {
  private gate: Promise<void> = Promise.resolve();
  private open: () => void = () => undefined;
  hold() {
    this.gate = new Promise((resolve) => (this.open = resolve));
  }
  release() {
    this.open();
  }
  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    await this.gate;
    return super.completeStructured(req);
  }
}

/** A model call that fails, counted — `jobs.attempts` cannot tell a retried job from a first-try success. */
class ThrowingLlm extends MockLLMProvider {
  constructor(private error: Error) {
    super('openrouter');
  }
  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ method: 'completeStructured', req });
    throw this.error;
  }
}

const structuredCalls = (llm: MockLLMProvider) => llm.calls.filter((c) => c.method === 'completeStructured');

/**
 * Intent over a real Postgres (plan S7): GET / POST /pulls/:id/intent, the
 * pr-intent job, the pr_intent row, workspace scoping. Every provider is a mock.
 */
d('/pulls/:id/intent (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;
  let prSeq = 100;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'intent-api', fullName: 'acme/intent-api' })
      .returning();
    repoId = repo!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function makeApp(
    providers: { openrouter?: LLMProvider; openai?: LLMProvider } = {},
    github: MockGitHubClient = new MockGitHubClient(),
  ) {
    const openrouter = new GatedLlm('openrouter', { structuredBySchema: { [INTENT_SCHEMA_NAME]: FIXTURE } });
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: DIFF }),
        github,
        secrets: new MockSecretsProvider(),
        llm: { openrouter: providers.openrouter ?? openrouter, openai: providers.openai ?? new MockLLMProvider('openai') },
      },
    });
    return { app, openrouter };
  }
  type App = Awaited<ReturnType<typeof makeApp>>['app'];

  /** A PR of the shared repo (or of `inRepo`), with one stored file patch so a diff exists without a clone. */
  async function newPr(body: string | null = 'Add a limiter to the public API.', inRepo = repoId, ws = workspaceId) {
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId: inRepo,
        number: prSeq++,
        title: 'Add rate limiting to public API',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'open',
        body,
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@ export const config = {\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
    return pr!;
  }

  const getIntent = async (app: App, prId: string) => {
    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/intent` });
    expect(res.statusCode).toBe(200);
    return PrIntentState.parse(res.json());
  };
  const derive = (app: App, prId: string) => app.inject({ method: 'POST', url: `/pulls/${prId}/intent` });
  const rowOf = async (prId: string) =>
    (await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId)))[0];

  it('GET on an unknown or foreign PR is 404 not_found; a bad id is 422', async () => {
    const { app } = await makeApp();
    const missing = await app.inject({ method: 'GET', url: '/pulls/00000000-0000-0000-0000-000000000000/intent' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toMatchObject({ code: 'not_found' });
    expect((await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/intent' })).statusCode).toBe(422);

    const { db } = pg.handle;
    const [ws] = await db.insert(t.workspaces).values({ name: `intent-other-${Date.now()}` }).returning();
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId: ws!.id, owner: 'other', name: 'app', fullName: 'other/app' })
      .returning();
    const foreign = await newPr('x', repo!.id, ws!.id);
    const get = await app.inject({ method: 'GET', url: `/pulls/${foreign.id}/intent` });
    expect(get.statusCode).toBe(404);
    expect(get.json().error).toMatchObject({ code: 'not_found' });
    const post = await derive(app, foreign.id);
    expect(post.statusCode).toBe(404);
    expect(post.json().error).toMatchObject({ code: 'not_found' });
    expect(await rowOf(foreign.id)).toBeUndefined();
    await app.close();
  });

  it('GET on a PR without a row is 200 with status "none"', async () => {
    const { app } = await makeApp();
    const pr = await newPr();
    expect(await getIntent(app, pr.id)).toMatchObject({
      pr_id: pr.id,
      status: 'none',
      error: null,
      stale: false,
      stale_reason: null,
      intent: null,
    });
    await app.close();
  });

  it('POST is 202 queued; after the job the intent is done with its record, and the cost sits in the pr_intent row', async () => {
    const { app, openrouter } = await makeApp();
    const pr = await newPr();

    openrouter.hold();
    const res = await derive(app, pr.id);
    expect(res.statusCode).toBe(202);
    const queued = PrIntentState.parse(res.json());
    expect(['queued', 'running']).toContain(queued.status);
    expect(queued.pr_id).toBe(pr.id);
    openrouter.release();
    await app.container.jobs.onIdle();

    const state = await getIntent(app, pr.id);
    expect(state).toMatchObject({
      status: 'done',
      error: null,
      stale: false,
      provider: 'openrouter',
      model: 'openai/gpt-5.4-nano',
      tokens_in: 100,
      tokens_out: 50,
      cost_usd: 0.001,
      intent: {
        pr_id: pr.id,
        summary: 'Adds rate limiting to the public API.',
        in_scope: ['src/config.ts'],
        out_of_scope: ['authentication'],
        head_sha: 'a1b2c3d4',
      },
    });
    expect(state.intent!.confidence).toBe('medium');
    expect(state.intent!.sources.map((s) => s.kind)).toEqual(expect.arrayContaining(['title', 'description', 'files']));

    const row = await rowOf(pr.id);
    expect(row).toMatchObject({ status: 'done', tokensIn: 100, tokensOut: 50, costUsd: 0.001, workspaceId });
    const [job] = await pg.handle.db.select().from(t.jobs).where(eq(t.jobs.id, row!.jobId!));
    expect(job).toMatchObject({ kind: 'pr-intent', status: 'done', payload: { prId: pr.id, workspaceId } });
    // The intent's cost is never an agent run's cost.
    expect(await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, pr.id))).toEqual([]);
    await app.close();
  });

  it('a POST while an attempt is active returns that attempt and makes one model call', async () => {
    const { app, openrouter } = await makeApp();
    const pr = await newPr();

    openrouter.hold();
    const first = PrIntentState.parse((await derive(app, pr.id)).json());
    const again = await derive(app, pr.id);
    expect(again.statusCode).toBe(202);
    expect(PrIntentState.parse(again.json()).requested_at).toBe(first.requested_at);
    const burst = await Promise.all([derive(app, pr.id), derive(app, pr.id), derive(app, pr.id)]);
    expect(burst.map((r) => r.statusCode)).toEqual([202, 202, 202]);
    expect(new Set(burst.map((r) => r.json().requested_at)).size).toBe(1);
    expect(await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, pr.id))).toHaveLength(1);

    openrouter.release();
    await app.container.jobs.onIdle();
    expect((await getIntent(app, pr.id)).status).toBe('done');
    expect(structuredCalls(openrouter)).toHaveLength(1);
    await app.close();
  });

  it('two PRs of one repo both end up done', async () => {
    const { app, openrouter } = await makeApp();
    const a =await newPr();
    const b = await newPr();

    expect([(await derive(app, a.id)).statusCode, (await derive(app, b.id)).statusCode]).toEqual([202, 202]);
    await app.container.jobs.onIdle();

    expect((await getIntent(app, a.id)).status).toBe('done');
    expect((await getIntent(app, b.id)).status).toBe('done');
    expect(structuredCalls(openrouter)).toHaveLength(2);
    await app.close();
  });

  it('with no OpenRouter key the attempt is failed and the job does not throw', async () => {
    // No openrouter override and no secret: the container raises ConfigError on first use.
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient(),
        secrets: new MockSecretsProvider(),
        llm: { openai: new MockLLMProvider('openai') },
      },
    });
    const pr = await newPr();

    expect((await derive(app, pr.id)).statusCode).toBe(202);
    await app.container.jobs.onIdle();

    const state = await getIntent(app, pr.id);
    expect(state.status).toBe('failed');
    expect(state.error).toEqual(expect.any(String));
    expect(state.intent).toBeNull();
    const row = await rowOf(pr.id);
    const [job] = await pg.handle.db.select().from(t.jobs).where(eq(t.jobs.id, row!.jobId!));
    expect(job).toMatchObject({ kind: 'pr-intent', status: 'done' });
    await app.close();
  });

  it('a failing model call is made once: the handler writes the failure to the row instead of throwing', async () => {
    const failing = new ThrowingLlm(new ConfigError('OPENROUTER_API_KEY is not configured'));
    const { app } = await makeApp({ openrouter: failing });
    const pr = await newPr();

    expect((await derive(app, pr.id)).statusCode).toBe(202);
    await app.container.jobs.onIdle();

    expect((await getIntent(app, pr.id)).status).toBe('failed');
    // The JobRunner retries a thrown 5xx; a recorded failure is not thrown.
    expect(structuredCalls(failing)).toHaveLength(1);
    await app.close();
  });

  it('a failed model call keeps the billed usage on the row', async () => {
    const failing = new ThrowingLlm(new LlmCallError('upstream 503', { tokensIn: 900, tokensOut: 40, costUsd: 0.0004 }));
    const { app } = await makeApp({ openrouter: failing });
    const pr = await newPr();

    await derive(app, pr.id);
    await app.container.jobs.onIdle();

    expect(await rowOf(pr.id)).toMatchObject({ status: 'failed', tokensIn: 900, tokensOut: 40, costUsd: 0.0004 });
    expect(structuredCalls(failing)).toHaveLength(1);
    await app.close();
  });

  it('a PR with no stored description gets it from GitHub', async () => {
    const github = new MockGitHubClient({ detail: { body: 'Refreshed from GitHub. Rate limit the API.' } });
    const { app } = await makeApp({}, github);
    const pr = await newPr(null);

    await derive(app, pr.id);
    await app.container.jobs.onIdle();

    const [stored] = await pg.handle.db.select().from(t.pullRequests).where(eq(t.pullRequests.id, pr.id));
    expect(stored!.body).toBe('Refreshed from GitHub. Rate limit the API.');
    expect((await getIntent(app, pr.id)).status).toBe('done');
    await app.close();
  });

  it('an empty description still gives a done intent with low confidence (A2)', async () => {
    const github = new MockGitHubClient({ detail: { body: null } });
    const { app } = await makeApp({}, github);
    const pr = await newPr(null);

    await derive(app, pr.id);
    await app.container.jobs.onIdle();

    const state = await getIntent(app, pr.id);
    expect(state.status).toBe('done');
    expect(state.intent).toMatchObject({ confidence: 'low', missing_context: [] });
    expect(state.intent!.summary.length).toBeGreaterThan(0);
    await app.close();
  });

  it('runs on the model picked in Settings → Models for the intent, and restores the default', async () => {
    const openai = new MockLLMProvider('openai', { structuredBySchema: { [INTENT_SCHEMA_NAME]: FIXTURE } });
    const { app, openrouter } = await makeApp({ openai });
    const pr = await newPr();
    const saved = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { feature_models: { review_intent: { provider: 'openai', model: 'gpt-4.1-mini' } } },
    });
    expect(saved.statusCode).toBe(200);

    try {
      expect((await derive(app, pr.id)).statusCode).toBe(202);
      await app.container.jobs.onIdle();
      expect(await getIntent(app, pr.id)).toMatchObject({ status: 'done', provider: 'openai', model: 'gpt-4.1-mini' });
      expect(structuredCalls(openai)).toHaveLength(1);
      expect(structuredCalls(openrouter)).toHaveLength(0);
    } finally {
      // Settings live in this file's shared database: later tests run on the default again.
      const restored = await app.inject({
        method: 'PUT',
        url: '/settings',
        payload: { feature_models: { review_intent: { provider: 'openrouter', model: 'openai/gpt-5.4-nano' } } },
      });
      expect(restored.statusCode).toBe(200);
    }
    await app.close();
  });

  it('a new app instance fails the attempts a previous process left queued or running', async () => {
    const pr = await newPr();
    await pg.handle.db.insert(t.prIntent).values({ prId: pr.id, workspaceId, status: 'running' });

    const { app } = await makeApp();
    const state = await getIntent(app, pr.id);
    expect(state.status).toBe('failed');
    expect(state.error).toMatch(/^The API restarted/);

    // The PR is free again.
    expect((await derive(app, pr.id)).statusCode).toBe(202);
    await app.container.jobs.onIdle();
    expect((await getIntent(app, pr.id)).status).toBe('done');
    await app.close();
  });
});
