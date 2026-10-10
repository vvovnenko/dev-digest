import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Review, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider, MockSecretsProvider } from '../src/adapters/mocks.js';
import { INTENT_SCHEMA_NAME } from '../src/modules/intent/constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@ export const config = {
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const INTENT = {
  summary: 'Adds rate limiting to the public API.',
  in_scope: ['rate limiter'],
  out_of_scope: ['config cleanup'],
  confidence: 'high',
  missing_context: [],
};

/** The reviewer flags its one finding as outside the intent. */
const reviewWith = (severity: 'WARNING' | 'CRITICAL'): Review => ({
  verdict: 'comment',
  summary: 'Config touched.',
  score: 70,
  findings: [
    {
      id: 'f-scope',
      severity,
      category: 'bug',
      title: 'Unrelated config change',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'The key has nothing to do with rate limiting.',
      confidence: 0.9,
      kind: 'finding',
      out_of_scope: true,
    },
  ],
});

/** An intent model that fails after being asked once. */
class FailingIntentLlm extends MockLLMProvider {
  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ method: 'completeStructured', req });
    throw new Error('upstream 503');
  }
}

const structuredCalls = (llm: MockLLMProvider) => llm.calls.filter((c) => c.method === 'completeStructured');
const userPrompt = (llm: MockLLMProvider) =>
  (structuredCalls(llm)[0]!.req as { messages: { role: string; content: string }[] }).messages.find(
    (m) => m.role === 'user',
  )!.content;

/**
 * Intent in a review run (plan S8): the pre-work step derives or reads the PR's intent, the engine
 * flags and filters findings by it. The flag DEVDIGEST_INTENT_ON_REVIEW is switched on here (vitest
 * sets it off for every other test).
 */
d('intent in a review run (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let seq = 0;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function setup(opts: { review: Review; intentLlm?: MockLLMProvider; githubBody?: string | null }) {
    const reviewLlm = new MockLLMProvider('openai', { structuredBySchema: { Review: opts.review } });
    const intentLlm =
      opts.intentLlm ?? new MockLLMProvider('openrouter', { structuredBySchema: { [INTENT_SCHEMA_NAME]: INTENT } });
    const app = await buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test', DEVDIGEST_INTENT_ON_REVIEW: 'true' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: DIFF }),
        github: new MockGitHubClient({ detail: { body: opts.githubBody ?? 'Rate limit the public API.' } }),
        secrets: new MockSecretsProvider(),
        llm: { openai: reviewLlm, openrouter: intentLlm },
      },
    });
    const name = `intent-review-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 482,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: 'Add rate limiting to the public API.',
      })
      .returning();
    await pg.handle.db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@ export const config = {\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: `Scope ${seq}`, provider: 'openai', model: 'gpt-4.1', system_prompt: 'review' },
      })
    ).json();
    return { app, pr: pr!, agentId: agent.id as string, reviewLlm, intentLlm };
  }

  type Setup = Awaited<ReturnType<typeof setup>>;
  async function runReview(s: Setup) {
    const res = await s.app.inject({ method: 'POST', url: `/pulls/${s.pr.id}/review`, payload: { agentId: s.agentId } });
    expect(res.statusCode).toBe(200);
    await waitForPrRuns(pg.handle.db, s.pr.id, { expected: 1 });
    const reviews = (await s.app.inject({ method: 'GET', url: `/pulls/${s.pr.id}/reviews` })).json();
    return { runId: res.json().runs[0].run_id as string, review: reviews[0] };
  }

  const storeIntent = (prId: string, over: Partial<typeof t.prIntent.$inferInsert> = {}) =>
    pg.handle.db.insert(t.prIntent).values({
      prId,
      workspaceId,
      status: 'done',
      intent: 'Adds rate limiting to the public API.',
      inScope: ['rate limiter'],
      outOfScope: ['config cleanup'],
      confidence: 'medium',
      headSha: 'a1b2c3d4',
      derivedAt: new Date(),
      ...over,
    });

  it('a PR without an intent gets one before the agents run; the prompt has it and its cost stays out of the run', async () => {
    const s = await setup({ review: reviewWith('WARNING') });
    const { runId } = await runReview(s);

    const [row] = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, s.pr.id));
    expect(row).toMatchObject({ status: 'done', costUsd: 0.001 });
    expect(structuredCalls(s.intentLlm)).toHaveLength(1);

    expect(userPrompt(s.reviewLlm)).toContain('## PR intent');
    const trace = (await s.app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.prompt_assembly.intent).toContain('## PR intent');
    expect(trace.log.map((l: { msg: string }) => l.msg)).toEqual(expect.arrayContaining([expect.stringMatching(/PR intent/i)]));

    // The run is billed for the review alone.
    const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId));
    expect(run!.costUsd).toBe(0.001);
    await s.app.close();
  });

  it('a stored intent for an older head is not re-derived; the out-of-scope WARNING stays, flagged', async () => {
    const s = await setup({ review: reviewWith('WARNING') });
    await storeIntent(s.pr.id, { headSha: 'old-head' });
    const { review } = await runReview(s);

    expect(structuredCalls(s.intentLlm)).toHaveLength(0);
    expect(userPrompt(s.reviewLlm)).toMatch(/may be outdated/i);
    expect(review.findings).toHaveLength(1);
    expect(review.findings[0]).toMatchObject({ id: expect.any(String), severity: 'WARNING', out_of_scope: true });
    await s.app.close();
  });

  it('a fresh medium intent filters the out-of-scope WARNING out', async () => {
    const s = await setup({ review: reviewWith('WARNING') });
    await storeIntent(s.pr.id);
    const { review } = await runReview(s);

    expect(structuredCalls(s.intentLlm)).toHaveLength(0);
    expect(review.findings).toEqual([]);
    expect(review.verdict).toBe('approve');
    expect(review.score).toBe(100);
    await s.app.close();
  });

  it('an out-of-scope CRITICAL stays with its flag and still requests changes', async () => {
    const s = await setup({ review: reviewWith('CRITICAL') });
    await storeIntent(s.pr.id);
    const { review } = await runReview(s);

    expect(review.findings).toHaveLength(1);
    expect(review.findings[0]).toMatchObject({ severity: 'CRITICAL', out_of_scope: true });
    expect(review.verdict).toBe('request_changes');
    await s.app.close();
  });

  it('an intent that cannot be derived does not fail the review', async () => {
    const s = await setup({ review: reviewWith('WARNING'), intentLlm: new FailingIntentLlm('openrouter') });
    const { review } = await runReview(s);

    expect(structuredCalls(s.intentLlm)).toHaveLength(1);
    const [row] = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, s.pr.id));
    expect(row!.status).toBe('failed');
    expect(userPrompt(s.reviewLlm)).not.toContain('## PR intent');
    // No intent, no scope filter: the flagged finding is kept, and the model's flag is reset.
    expect(review.findings).toHaveLength(1);
    expect(review.findings[0].out_of_scope).toBe(false);
    await s.app.close();
  });
});
