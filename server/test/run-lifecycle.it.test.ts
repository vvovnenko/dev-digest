/**
 * The run lifecycle end to end against Postgres: a cancel stops a live LLM call
 * and is never overwritten by `done`; a finished run commits its review, sha
 * and trace together; a failure records what it spent; an empty diff fails;
 * the event stream ends for finished runs and lets go of clients that leave.
 */
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { LLMProvider, Review, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockEmbedder, MockGitClient, MockSecretsProvider } from '../src/adapters/mocks.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import { RUN_SHUTDOWN_ERROR } from '../src/modules/reviews/run-executor.js';
import { RunBus } from '../src/platform/sse.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded secret.',
  score: 40,
  findings: [
    {
      id: 'f1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live key is committed.',
      confidence: 0.95,
      kind: 'finding',
    },
  ],
};

/** An LLM whose call runs until the test releases it or the run's signal aborts it. */
function gatedLlm() {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => (markStarted = resolve));
  const llm: LLMProvider = {
    id: 'openrouter',
    async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
      markStarted();
      await new Promise<void>((resolve, reject) => {
        void released.then(resolve);
        req.signal?.addEventListener(
          'abort',
          () => reject(Object.assign(new Error('aborted'), { usage: { tokensIn: 7, tokensOut: 3, costUsd: 0.0005 } })),
          { once: true },
        );
      });
      return { data: REVIEW as T, model: req.model, tokensIn: 100, tokensOut: 50, costUsd: 0.001, raw: '{}', attempts: 1 };
    },
    listModels: async () => [],
    complete: async () => {
      throw new Error('unused');
    },
    embed: async () => [],
  };
  return { llm, release, started };
}

/** An LLM that bills a call and then fails it. */
const failingLlm: LLMProvider = {
  id: 'openrouter',
  async completeStructured() {
    throw Object.assign(new Error('schema never validated'), { usage: { tokensIn: 30, tokensOut: 20, costUsd: 0.002 } });
  },
  listModels: async () => [],
  complete: async () => {
    throw new Error('unused');
  },
  embed: async () => [],
};

/** A RunBus that counts open subscriptions. */
class CountingRunBus extends RunBus {
  open = 0;
  override subscribe(...args: Parameters<RunBus['subscribe']>) {
    const off = super.subscribe(...args);
    this.open++;
    let subscribed = true;
    return () => {
      if (subscribed) this.open--;
      subscribed = false;
      off();
    };
  }
}

/** The `data:` payloads of an SSE body. */
const sseData = (body: string) =>
  body
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)) as { kind: string; msg: string });

let seq = 0;
async function setupPr(db: PgFixture['handle']['db'], workspaceId: string, withFiles = true) {
  const name = `lifecycle-${seq++}`;
  const [repo] = await db.insert(t.repos).values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` }).returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 7,
      title: 'Add config',
      author: 'dev',
      branch: 'feat',
      base: 'main',
      headSha: 'head-sha-1',
      status: 'open',
    })
    .returning();
  if (withFiles) {
    await db.insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
  }
  return pr!;
}

d('run lifecycle (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let agentId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [agent] = await pg.handle.db.select().from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
    agentId = agent!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const appWith = (llm: LLMProvider, diff = DIFF, runBus?: RunBus) =>
    buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff }),
        secrets: new MockSecretsProvider(),
        llm: { openrouter: llm },
        ...(runBus ? { runBus } : {}),
      },
    });

  const startRun = async (app: Awaited<ReturnType<typeof appWith>>, prId: string) => {
    const res = await app.inject({ method: 'POST', url: `/pulls/${prId}/review`, payload: { agentId } });
    expect(res.statusCode).toBe(200);
    return res.json().runs[0].run_id as string;
  };

  const runRow = async (runId: string) =>
    (await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, runId)))[0]!;
  const reviewsOf = (runId: string) => pg.handle.db.select().from(t.reviews).where(eq(t.reviews.runId, runId));

  it('trace retention drops only the traces of finished runs started before the cutoff', async () => {
    const pr = await setupPr(pg.handle.db, workspaceId);
    const DAY = 24 * 60 * 60 * 1000;
    const run = async (status: string, daysAgo: number) => {
      const [row] = await pg.handle.db
        .insert(t.agentRuns)
        .values({ workspaceId, agentId, prId: pr.id, status, ranAt: new Date(Date.now() - daysAgo * DAY) })
        .returning({ id: t.agentRuns.id });
      await pg.handle.db.insert(t.runTraces).values({ runId: row!.id, trace: { note: 'trace' } });
      return row!.id;
    };
    const oldDone = await run('done', 100);
    const oldRunning = await run('running', 100);
    const fresh = await run('failed', 1);

    const pruned = await new ReviewRepository(pg.handle.db).pruneRunTraces(new Date(Date.now() - 30 * DAY));
    expect(pruned).toBeGreaterThanOrEqual(1);
    const traced = async (id: string) =>
      (await pg.handle.db.select().from(t.runTraces).where(eq(t.runTraces.runId, id))).length;
    expect(await traced(oldDone)).toBe(0);
    expect(await traced(oldRunning)).toBe(1);
    expect(await traced(fresh)).toBe(1);
    expect((await runRow(oldDone)).status).toBe('done'); // the run row (cost, history) stays
    await pg.handle.db.update(t.agentRuns).set({ status: 'failed' }).where(eq(t.agentRuns.id, oldRunning));
  });

  it('runs at most REVIEW_CONCURRENCY review requests at once; the next waits its turn, then runs', async () => {
    const gate = gatedLlm();
    const app = await buildApp({
      config: { ...config(), reviewConcurrency: 1 },
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        secrets: new MockSecretsProvider(),
        llm: { openrouter: gate.llm },
      },
    });
    const first = await setupPr(pg.handle.db, workspaceId);
    const second = await setupPr(pg.handle.db, workspaceId);
    await startRun(app, first.id);
    await gate.started;

    const waiting = await startRun(app, second.id);
    expect(app.container.runBus.buffer(waiting).map((e) => e.msg)).toEqual([
      expect.stringMatching(/^Waiting for a free review slot/),
    ]);
    expect((await runRow(waiting)).status).toBe('running');

    gate.release();
    await waitForPrRuns(pg.handle.db, first.id);
    await waitForPrRuns(pg.handle.db, second.id);
    expect((await runRow(waiting)).status).toBe('done');
    await app.close();
  });

  it('a cancel aborts the in-flight LLM call and ends the run cancelled, with no review', async () => {
    const gate = gatedLlm();
    const app = await appWith(gate.llm);
    const pr = await setupPr(pg.handle.db, workspaceId);
    const runId = await startRun(app, pr.id);
    await gate.started;

    const cancel = await app.inject({ method: 'POST', url: `/runs/${runId}/cancel` });
    expect(cancel.statusCode).toBeLessThan(300);
    await waitForPrRuns(pg.handle.db, pr.id);
    // Poll until the executor has recorded the cancel (duration + usage + trace).
    for (let i = 0; i < 100 && (await runRow(runId)).durationMs == null; i++) await new Promise((r) => setTimeout(r, 25));

    const run = await runRow(runId);
    expect(run.status).toBe('cancelled');
    expect(run.error).toBe('Cancelled by user');
    expect(run.tokensIn).toBe(7); // what the aborted call had already cost
    expect(await reviewsOf(runId)).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).statusCode).toBe(200);

    gate.release(); // a late answer must change nothing
    await new Promise((r) => setTimeout(r, 100));
    expect((await runRow(runId)).status).toBe('cancelled');
    expect(await reviewsOf(runId)).toHaveLength(0);
    await app.close();
  });

  it('a second review by the same agent while one is running is refused (409), not paid for twice', async () => {
    const gate = gatedLlm();
    const app = await appWith(gate.llm);
    const pr = await setupPr(pg.handle.db, workspaceId);
    const runId = await startRun(app, pr.id);
    await gate.started;

    const again = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId } });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('run_in_progress');
    const runs = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, pr.id));
    expect(runs).toHaveLength(1);

    gate.release();
    await waitForPrRuns(pg.handle.db, pr.id);
    expect((await runRow(runId)).status).toBe('done');
    await app.close();
  });

  it('a run cancelled while its review is being saved stays cancelled and saves nothing', async () => {
    const repo = new ReviewRepository(pg.handle.db);
    const pr = await setupPr(pg.handle.db, workspaceId);
    const runId = await repo.createAgentRun({ workspaceId, agentId, prId: pr.id, provider: 'openrouter', model: 'm' });
    await repo.cancelRunIfRunning(workspaceId, runId);

    const saved = await repo.completeRunWithReview(runId, {
      run: { durationMs: 5, tokensIn: 1, tokensOut: 1, costUsd: 0, findingsCount: 1, grounding: '1/1 passed', score: 65, blockers: 1 },
      review: { workspaceId, prId: pr.id, agentId, kind: 'review', verdict: 'request_changes', summary: 's', score: 65, model: 'm' },
      findings: REVIEW.findings,
      reviewedSha: 'head-sha-1',
      trace: {} as never,
    });

    expect(saved).toBeNull();
    expect((await runRow(runId)).status).toBe('cancelled');
    expect(await reviewsOf(runId)).toHaveLength(0);
    const [pull] = await pg.handle.db.select().from(t.pullRequests).where(eq(t.pullRequests.id, pr.id));
    expect(pull!.lastReviewedSha).toBeNull();
  });

  it('a finished run has its review, reviewed sha and trace the moment it reads done', async () => {
    const gate = gatedLlm();
    gate.release();
    const app = await appWith(gate.llm);
    const pr = await setupPr(pg.handle.db, workspaceId);
    const runId = await startRun(app, pr.id);
    await waitForPrRuns(pg.handle.db, pr.id);

    expect((await runRow(runId)).status).toBe('done');
    expect((await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).statusCode).toBe(200);
    const [review] = await reviewsOf(runId);
    expect(review!.verdict).toBe('request_changes');
    const [pull] = await pg.handle.db.select().from(t.pullRequests).where(eq(t.pullRequests.id, pr.id));
    expect(pull!.lastReviewedSha).toBe('head-sha-1');
    await app.close();
  });

  it('a failed run records what its calls cost', async () => {
    const app = await appWith(failingLlm);
    const pr = await setupPr(pg.handle.db, workspaceId);
    const runId = await startRun(app, pr.id);
    await waitForPrRuns(pg.handle.db, pr.id);

    const run = await runRow(runId);
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/schema never validated/);
    expect([run.tokensIn, run.tokensOut]).toEqual([30, 20]);
    expect(Number(run.costUsd)).toBeCloseTo(0.002, 10);
    await app.close();
  });

  it('an empty diff fails the run instead of approving an unreviewed PR', async () => {
    const gate = gatedLlm();
    gate.release();
    const app = await appWith(gate.llm, '');
    const pr = await setupPr(pg.handle.db, workspaceId, false);
    const runId = await startRun(app, pr.id);
    await waitForPrRuns(pg.handle.db, pr.id);

    const run = await runRow(runId);
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/no reviewable text/);
    expect(await reviewsOf(runId)).toHaveLength(0);
    await app.close();
  });
  it('the stream of a run this process no longer remembers replays its saved log and ends', async () => {
    const gate = gatedLlm();
    gate.release();
    const app = await appWith(gate.llm);
    const pr = await setupPr(pg.handle.db, workspaceId);
    const runId = await startRun(app, pr.id);
    await waitForPrRuns(pg.handle.db, pr.id);
    await app.close();

    // A restarted API: a fresh, empty RunBus.
    const restarted = await appWith(gate.llm);
    const res = await restarted.inject({ method: 'GET', url: `/runs/${runId}/events` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    const trace = (await restarted.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.log.length).toBeGreaterThan(0);
    const events = sseData(res.body);
    expect(events.slice(0, -1).map((e) => e.msg)).toEqual(trace.log.map((l: { msg: string }) => l.msg));
    // The stream says it is over, so the client doesn't reconnect.
    expect(res.body.trimEnd()).toMatch(new RegExp(`event: done\\ndata: \\{"runId":"${runId}"\\}$`));

    expect((await restarted.inject({ method: 'GET', url: `/runs/${randomUUID()}/events` })).statusCode).toBe(404);
    await restarted.close();
  });

  it('a client that leaves the stream of a live run releases its subscription', async () => {
    const bus = new CountingRunBus();
    const gate = gatedLlm();
    const app = await appWith(gate.llm, DIFF, bus);
    const pr = await setupPr(pg.handle.db, workspaceId);
    const runId = await startRun(app, pr.id);
    await gate.started;
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;

    const client = http.get({ host: '127.0.0.1', port, path: `/runs/${runId}/events`, agent: false });
    const [res] = (await once(client, 'response')) as [http.IncomingMessage];
    const [first] = (await once(res, 'data')) as [Buffer];
    expect(String(first)).toMatch(/^retry: /); // the plugin's preamble: the stream is open
    expect(bus.open).toBe(1);

    client.destroy();
    for (let i = 0; i < 100 && bus.open > 0; i++) await new Promise((r) => setTimeout(r, 20));
    expect(bus.open).toBe(0);

    gate.release();
    await waitForPrRuns(pg.handle.db, pr.id);
    await app.close();
  });
  it('shutting the API down mid-run records the run as failed with the reason, not as a user cancel', async () => {
    const gate = gatedLlm();
    const app = await appWith(gate.llm);
    const pr = await setupPr(pg.handle.db, workspaceId);
    const runId = await startRun(app, pr.id);
    await gate.started;

    await app.close(); // waits for the run to record how it ended

    const run = await runRow(runId);
    expect(run.status).toBe('failed');
    expect(run.error).toBe(RUN_SHUTDOWN_ERROR);
    expect(run.tokensIn).toBe(7); // what the aborted call had already cost
    const [trace] = await pg.handle.db.select().from(t.runTraces).where(eq(t.runTraces.runId, runId));
    expect(trace).toBeDefined();
    expect(await reviewsOf(runId)).toHaveLength(0);
  });
  it("a failed run's trace reports the same usage as its row", async () => {
    const app = await appWith(failingLlm);
    const pr = await setupPr(pg.handle.db, workspaceId);
    const runId = await startRun(app, pr.id);
    await waitForPrRuns(pg.handle.db, pr.id);

    const { stats } = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect([stats.tokens_in, stats.tokens_out]).toEqual([30, 20]);
    expect(stats.cost_usd).toBeCloseTo(0.002, 10);
    await app.close();
  });
});
