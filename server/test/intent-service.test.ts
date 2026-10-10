import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type {
  FeatureModelChoice,
  GitHubClient,
  IssueMeta,
  LLMProvider,
  PrDetail,
  RepoRef,
  StructuredRequest,
  StructuredResult,
  UnifiedDiff,
} from '@devdigest/shared';
import { LlmCallError } from '@devdigest/reviewer-core';
import { IntentService } from '../src/modules/intent/service.js';
import { INTENT_JOB_KIND, INTENT_SCHEMA_NAME } from '../src/modules/intent/constants.js';
import type {
  IntentFailure,
  IntentRecord,
  IntentResult,
  NewIntentAttempt,
} from '../src/modules/intent/domain.js';
import type { IntentPullSource, IntentStore, JobQueue } from '../src/modules/intent/ports.js';
import type { PullRecord, PullRepoRef } from '../src/modules/pulls/domain.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { MockGitHubClient, MockLLMProvider, MockUrlFetcher } from '../src/adapters/mocks.js';
import { ConfigError, NotFoundError, ValidationError } from '../src/platform/errors.js';
import { TimeoutError } from '../src/platform/resilience.js';

/**
 * IntentService (plan S6, docs/plans/2026-10-09-intent-layer.md) on in-memory
 * fakes of its ports. The plan names the ports, not their signatures; the ones
 * assumed here are in the test report:
 *
 *   deps = { store, pulls, diffs, fetcher, jobs, github, llm, model, log }
 *   service.state(ws, prId) · requestDerive(ws, prId) · registerJobHandler()
 *   service.runJob(payload) · reapInterrupted() · forReview(ws, pull, { diff, log })
 */

const ACTIVE = new Set(['queued', 'running']);

/** The intent store: one row per PR, workspace-scoped, claimed only while no attempt is active. */
class FakeIntentStore implements IntentStore {
  rows = new Map<string, IntentRecord>();

  private row(ws: string, prId: string) {
    const r = this.rows.get(prId);
    return r && r.workspaceId === ws ? r : undefined;
  }
  async get(ws: string, prId: string) {
    return this.row(ws, prId);
  }
  async claim(attempt: NewIntentAttempt): Promise<IntentRecord | undefined> {
    const prev = this.row(attempt.workspaceId, attempt.prId);
    if (prev && ACTIVE.has(prev.status)) return undefined;
    const fresh = {
      status: 'queued' as const,
      error: null,
      jobId: null,
      provider: attempt.provider,
      model: attempt.model,
      tokensIn: null,
      tokensOut: null,
      costUsd: null,
      requestedAt: new Date(),
      finishedAt: null,
    };
    const row: IntentRecord = prev ? Object.assign(prev, fresh) : { ...emptyRecord(attempt.workspaceId, attempt.prId), ...fresh };
    this.rows.set(attempt.prId, row);
    return row;
  }
  async setJobId(ws: string, prId: string, jobId: string) {
    const r = this.row(ws, prId);
    if (r) r.jobId = jobId;
  }
  async markRunning(ws: string, prId: string) {
    const r = this.row(ws, prId);
    if (!r || !ACTIVE.has(r.status)) return undefined;
    r.status = 'running';
    return r;
  }
  async complete(ws: string, prId: string, result: IntentResult) {
    const r = this.row(ws, prId);
    if (!r || r.status !== 'running') return undefined;
    return Object.assign(r, result, { status: 'done' as const, error: null, finishedAt: new Date(), derivedAt: new Date() });
  }
  async fail(ws: string, prId: string, failure: IntentFailure) {
    const r = this.row(ws, prId);
    if (!r || !ACTIVE.has(r.status)) return;
    const { usage } = failure;
    Object.assign(r, {
      status: 'failed' as const,
      error: failure.error,
      finishedAt: new Date(),
      ...(usage && { tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, costUsd: usage.costUsd }),
    });
  }
  async reapActive(error: string) {
    const active = [...this.rows.values()].filter((r) => ACTIVE.has(r.status));
    for (const r of active) Object.assign(r, { status: 'failed' as const, error, finishedAt: new Date() });
    return active.length;
  }
}

function emptyRecord(workspaceId: string, prId: string): IntentRecord {
  return {
    prId,
    workspaceId,
    status: 'queued',
    error: null,
    jobId: null,
    intent: null,
    inScope: [],
    outOfScope: [],
    confidence: null,
    sources: [],
    missingContext: [],
    headSha: null,
    inputHash: null,
    provider: null,
    model: null,
    tokensIn: null,
    tokensOut: null,
    costUsd: null,
    requestedAt: new Date(),
    finishedAt: null,
    derivedAt: null,
  };
}

class FakeJobQueue implements JobQueue {
  handlers = new Map<string, (payload: unknown, ctx: { jobId: string }) => Promise<void>>();
  enqueued: { id: string; workspaceId: string; kind: string; payload: unknown }[] = [];
  failWith: Error | null = null;

  register(kind: string, handler: (payload: unknown, ctx: { jobId: string }) => Promise<void>) {
    this.handlers.set(kind, handler);
  }
  async enqueue(workspaceId: string, kind: string, payload: unknown) {
    if (this.failWith) throw this.failWith;
    const id = `job${this.enqueued.length + 1}`;
    this.enqueued.push({ id, workspaceId, kind, payload });
    return { id };
  }
  /** Runs the i-th enqueued job's handler, as the JobRunner would. */
  run(i: number): Promise<void> {
    const job = this.enqueued[i]!;
    return this.handlers.get(job.kind)!(job.payload, { jobId: job.id });
  }
}

/** The pulls port over one PR; replaceDetail refreshes the stored body/title/head like the real repository. */
class FakePulls implements IntentPullSource {
  constructor(
    public pull: PullRecord,
    public repo: PullRepoRef,
    private workspaceId = 'w1',
  ) {}
  async pullInWorkspace(ws: string, prId: string) {
    return ws === this.workspaceId && prId === this.pull.id ? { pull: this.pull, repo: this.repo } : undefined;
  }
  async replaceDetail(prId: string, detail: PrDetail) {
    if (prId !== this.pull.id) return;
    this.pull = { ...this.pull, body: detail.body ?? null, title: detail.title, headSha: detail.head_sha };
  }
}

class FakeDiffs {
  constructor(public raw: string) {}
  async forPull(): Promise<UnifiedDiff> {
    return parseUnifiedDiff(this.raw);
  }
}

class FakeLog {
  entries: { level: 'info' | 'warn'; obj: unknown; msg: string | undefined }[] = [];
  info(obj: unknown, msg?: string) {
    this.entries.push({ level: 'info', obj, msg });
  }
  warn(obj: unknown, msg?: string) {
    this.entries.push({ level: 'warn', obj, msg });
  }
}

/** A model call that fails after billing, as reviewer-core's providers report it. */
class FailingLlm extends MockLLMProvider {
  constructor() {
    super('openrouter');
  }
  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ method: 'completeStructured', req });
    throw new LlmCallError('upstream 503', { tokensIn: 900, tokensOut: 40, costUsd: 0.0004 });
  }
}

const DIFF = [
  'diff --git a/src/config.ts b/src/config.ts',
  '--- a/src/config.ts',
  '+++ b/src/config.ts',
  '@@ -10,3 +10,4 @@ export const config = {',
  '   port: 3000,',
  '+  stripeKey: "sk_live_xxx",',
  '-  oldKey: 1,',
  '   redisUrl: x,',
].join('\n');

const MODEL: FeatureModelChoice = { provider: 'openrouter', model: 'openai/gpt-5.4-nano' };
const FIXTURE = {
  summary: 'Adds rate limiting to the public API.',
  in_scope: ['src/config.ts'],
  out_of_scope: ['authentication'],
  confidence: 'high',
  missing_context: [],
};

const PULL: PullRecord = {
  id: 'pr1',
  workspaceId: 'w1',
  repoId: 'r1',
  number: 482,
  title: 'Add rate limiting to public API',
  author: 'marisa.koch',
  branch: 'feat/rate-limit-public',
  base: 'main',
  headSha: 'a1b2c3d4',
  lastReviewedSha: null,
  additions: 1,
  deletions: 1,
  filesCount: 1,
  status: 'open',
  body: 'old local body',
  openedAt: null,
  updatedAt: null,
};
const REPO: PullRepoRef = { id: 'r1', owner: 'acme', name: 'payments-api' };

function llmWith(fixture: unknown = FIXTURE) {
  return new MockLLMProvider('openrouter', { structuredBySchema: { [INTENT_SCHEMA_NAME]: fixture } });
}

/** MockGitHubClient with a scriptable issues API and file reader (without touching the shared mock). */
function githubWith(o: {
  detail?: Partial<PrDetail>;
  issues?: Record<number, IssueMeta | Error>;
  files?: Record<string, string | null>;
}) {
  const fileCalls: { repo: RepoRef; path: string; ref: string }[] = [];
  const gh = Object.assign(new MockGitHubClient(o.detail ? { detail: o.detail } : {}), {
    getIssue: async (_repo: RepoRef, n: number): Promise<IssueMeta> => {
      const r = o.issues?.[n];
      if (r instanceof Error) throw r;
      return r ?? { number: n, title: `Issue #${n}`, body: 'mock issue', state: 'open' };
    },
    getFileText: async (repo: RepoRef, path: string, ref: string): Promise<string | null> => {
      fileCalls.push({ repo, path, ref });
      return o.files?.[path] ?? null;
    },
  });
  return { gh, fileCalls };
}

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

const promptOf = (llm: MockLLMProvider, i = 0) => {
  const req = llm.calls.filter((c) => c.method === 'completeStructured')[i]!.req as {
    messages: { role: string; content: string }[];
  };
  return { all: req.messages.map((m) => m.content).join('\n'), system: req.messages.find((m) => m.role === 'system')!.content };
};
const structuredCalls = (llm: MockLLMProvider) => llm.calls.filter((c) => c.method === 'completeStructured');

describe('IntentService', () => {
  let store: FakeIntentStore;
  let jobs: FakeJobQueue;
  let pulls: FakePulls;
  let diffs: FakeDiffs;
  let fetcher: MockUrlFetcher;
  let log: FakeLog;
  let llm: MockLLMProvider;
  let github: GitHubClient;
  let fileCalls: { repo: RepoRef; path: string; ref: string }[];
  let resolveLlm: () => Promise<LLMProvider>;
  let service: IntentService;

  const useGithub = (o: Parameters<typeof githubWith>[0]) => {
    ({ gh: github, fileCalls } = githubWith(o));
  };
  const build = () => {
    service = new IntentService({
      store,
      pulls,
      diffs,
      fetcher,
      jobs,
      github: async () => github,
      llm: async () => resolveLlm(),
      model: async () => MODEL,
      log,
    });
    service.registerJobHandler();
  };
  /** POST /pulls/:id/intent, then the job. */
  const derive = async () => {
    const queued = await service.requestDerive('w1', 'pr1');
    await jobs.run(jobs.enqueued.length - 1);
    return queued;
  };

  beforeEach(() => {
    store = new FakeIntentStore();
    jobs = new FakeJobQueue();
    pulls = new FakePulls({ ...PULL }, REPO);
    diffs = new FakeDiffs(DIFF);
    fetcher = new MockUrlFetcher();
    log = new FakeLog();
    llm = llmWith();
    resolveLlm = async () => llm;
    useGithub({ detail: { body: 'Closes #5. Rate limit the public API.' }, issues: { 5: { number: 5, title: 'Rate limits', body: 'ISSUE-5-BODY', state: 'open' } } });
    build();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a PR without a row is "none"', async () => {
    expect(await service.state('w1', 'pr1')).toMatchObject({
      pr_id: 'pr1',
      status: 'none',
      error: null,
      stale: false,
      stale_reason: null,
      intent: null,
    });
  });

  it('refuses an unknown PR and another workspace’s PR with NotFoundError', async () => {
    await expect(service.state('w1', 'nope')).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.state('other', 'pr1')).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.requestDerive('other', 'pr1')).rejects.toBeInstanceOf(NotFoundError);
    expect(jobs.enqueued).toEqual([]);
    expect(store.rows.size).toBe(0);
  });

  it('manual derive: queues a pr-intent job (payload without repoId), then stores a done intent with its sources and usage', async () => {
    fetcher = new MockUrlFetcher({ 'https://example.com/docs/spec.md': { body: 'URL-SPEC-BODY' } });
    useGithub({
      detail: { body: 'Closes #5. Spec: https://example.com/docs/spec.md', title: PULL.title, head_sha: 'a1b2c3d4' },
      issues: { 5: { number: 5, title: 'Rate limits', body: 'ISSUE-5-BODY', state: 'open' } },
    });
    build();

    const queued = await service.requestDerive('w1', 'pr1');
    expect(queued.status).toBe('queued');
    expect(jobs.enqueued).toHaveLength(1);
    expect(jobs.enqueued[0]).toMatchObject({ workspaceId: 'w1', kind: INTENT_JOB_KIND });
    expect(jobs.enqueued[0]!.payload).toEqual({ workspaceId: 'w1', prId: 'pr1' });
    expect(INTENT_JOB_KIND).toBe('pr-intent');

    await jobs.run(0);
    const state = await service.state('w1', 'pr1');
    expect(state).toMatchObject({
      pr_id: 'pr1',
      status: 'done',
      error: null,
      stale: false,
      stale_reason: null,
      provider: 'openrouter',
      model: 'openai/gpt-5.4-nano',
      tokens_in: 100,
      tokens_out: 50,
      cost_usd: 0.001,
      intent: {
        pr_id: 'pr1',
        summary: 'Adds rate limiting to the public API.',
        in_scope: ['src/config.ts'],
        out_of_scope: ['authentication'],
        confidence: 'high',
        missing_context: [],
        head_sha: 'a1b2c3d4',
      },
    });
    expect(state.intent!.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'title', status: 'used' }),
        expect.objectContaining({ kind: 'description', status: 'used' }),
        expect.objectContaining({ kind: 'files', status: 'used' }),
        expect.objectContaining({ kind: 'issue', ref: '#5', status: 'used' }),
        expect.objectContaining({ kind: 'url', ref: 'example.com/docs/spec.md', status: 'used' }),
      ]),
    );

    // One model call, on the row's model, with the A1 token budget; every source in its own untrusted block.
    expect(structuredCalls(llm)).toHaveLength(1);
    expect(structuredCalls(llm)[0]!.req).toMatchObject({ model: 'openai/gpt-5.4-nano', schemaName: INTENT_SCHEMA_NAME, maxTokens: 8000 });
    const { all } = promptOf(llm);
    expect(all).toContain('ISSUE-5-BODY');
    expect(all).toContain('URL-SPEC-BODY');
    expect(all).toMatch(/<untrusted source="intent-issue-\d+">/);
    expect(all).toMatch(/<untrusted source="intent-url-\d+">/);
  });

  it('a manual derive reads the description fresh from GitHub and stores it', async () => {
    useGithub({ detail: { body: 'FRESH-GITHUB-BODY' } });
    build();
    await derive();
    expect(pulls.pull.body).toBe('FRESH-GITHUB-BODY');
    expect(promptOf(llm).all).toContain('FRESH-GITHUB-BODY');
    expect(promptOf(llm).all).not.toContain('old local body');
  });

  it('A2: a PR with no description and no links is done, with a summary and low confidence, from title, branch and outline only', async () => {
    useGithub({ detail: { body: null } });
    build();
    await derive();

    const state = await service.state('w1', 'pr1');
    expect(state.status).toBe('done');
    expect(state.intent!.summary.length).toBeGreaterThan(0);
    // The model said "high"; with no description and no linked document the code caps it.
    expect(state.intent!.confidence).toBe('low');
    expect(state.intent!.missing_context).toEqual([]);
    expect(state.intent!.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'description', status: 'skipped', reason: 'empty' }),
        expect.objectContaining({ kind: 'title', status: 'used' }),
        expect.objectContaining({ kind: 'files', status: 'used' }),
      ]),
    );

    const { all, system } = promptOf(llm);
    expect(all).toContain('Add rate limiting to public API');
    expect(all).toContain('feat/rate-limit-public');
    expect(all).toContain('src/config.ts');
    expect(all).toContain('@@ -10,3 +10,4 @@ export const config = {');
    // The outline carries no line of the diff body.
    expect(all).not.toContain('stripeKey');
    expect(all).not.toContain('oldKey');
    expect(all).not.toContain('redisUrl');
    expect(all).not.toContain('+++ b/');
    expect(all).not.toContain('--- a/');
    // The system prompt tells the model to infer, never to refuse.
    expect(system).toContain('infer the most likely intent');
    expect(system).toContain('never refuse');
  });

  it('A2: a description without links stays at most medium', async () => {
    useGithub({ detail: { body: 'Add a limiter to the public endpoints.' } });
    build();
    await derive();
    expect((await service.state('w1', 'pr1')).intent!.confidence).toBe('medium');
  });

  const UNAVAILABLE: [Error, string][] = [
    [httpError(404), 'not_found'],
    [httpError(403), 'forbidden'],
    [new TimeoutError(15000), 'timeout'],
    [new Error('boom'), 'error'],
  ];
  it.each(UNAVAILABLE)('A2: an unavailable issue (%s) is missing_context "#999: %s" and caps confidence at medium', async (err, reason) => {
    useGithub({ detail: { body: 'Fixes #999. Rate limit the API.' }, issues: { 999: err } });
    build();
    await derive();

    const state = await service.state('w1', 'pr1');
    expect(state.status).toBe('done');
    expect(state.intent!.missing_context).toEqual([`#999: ${reason}`]);
    expect(state.intent!.confidence).toBe('medium');
    expect(state.intent!.sources).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'issue', ref: '#999', status: 'unavailable', reason })]),
    );
    expect(promptOf(llm).all).not.toContain('Issue #999');
  });

  it('a ticket key is unavailable: no_integration and nothing is fetched for it', async () => {
    useGithub({ detail: { body: 'Implements PAY-12 rate limiting.' } });
    build();
    await derive();

    const state = await service.state('w1', 'pr1');
    expect(state.intent!.missing_context).toEqual(['PAY-12: no_integration']);
    expect(state.intent!.sources).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'ticket', ref: 'PAY-12', status: 'unavailable', reason: 'no_integration' })]),
    );
    expect(fetcher.calls).toEqual([]);
    expect(fileCalls).toEqual([]);
  });

  it('a URL that cannot be fetched is unavailable with a reason code, never the error text', async () => {
    useGithub({ detail: { body: 'Spec: https://example.com/spec.md and more.' } });
    build();
    await derive();

    const state = await service.state('w1', 'pr1');
    expect(state.status).toBe('done');
    expect(state.intent!.missing_context).toHaveLength(1);
    expect(state.intent!.missing_context[0]).toMatch(/^example\.com\/spec\.md: [a-z_]+$/);
    expect(state.intent!.confidence).toBe('medium');
  });

  it('a repo file is read at the head sha and goes to the model in its own block', async () => {
    useGithub({ detail: { body: 'See docs/plan.md for the plan.' }, files: { 'docs/plan.md': 'PLAN-FILE-BODY' } });
    build();
    await derive();

    expect(fileCalls).toEqual([{ repo: { owner: 'acme', name: 'payments-api' }, path: 'docs/plan.md', ref: 'a1b2c3d4' }]);
    const state = await service.state('w1', 'pr1');
    expect(state.intent!.sources).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'repo_file', ref: 'docs/plan.md', status: 'used' })]),
    );
    expect(state.intent!.confidence).toBe('high');
    expect(promptOf(llm).all).toContain('PLAN-FILE-BODY');
    expect(promptOf(llm).all).toMatch(/<untrusted source="intent-repo_file-\d+">/);
  });

  it('a repo file the PR adds whole is taken from the diff, not from GitHub', async () => {
    diffs = new FakeDiffs(
      [
        'diff --git a/docs/plan.md b/docs/plan.md',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/docs/plan.md',
        '@@ -0,0 +1,2 @@',
        '+PLAN-LINE-ONE',
        '+PLAN-LINE-TWO',
      ].join('\n'),
    );
    useGithub({ detail: { body: 'See docs/plan.md for the plan.' }, files: { 'docs/plan.md': 'FROM-GITHUB' } });
    build();
    await derive();

    expect(fileCalls).toEqual([]);
    const { all } = promptOf(llm);
    expect(all).toContain('PLAN-LINE-ONE');
    expect(all).toContain('PLAN-LINE-TWO');
    expect(all).not.toContain('FROM-GITHUB');
    expect((await service.state('w1', 'pr1')).intent!.sources).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'repo_file', ref: 'docs/plan.md', status: 'used' })]),
    );
  });

  it('a second request while an attempt is active changes nothing; after it finishes a new request queues again', async () => {
    const first = await service.requestDerive('w1', 'pr1');
    const again = await service.requestDerive('w1', 'pr1');
    expect(again.status).toBe('queued');
    expect(jobs.enqueued).toHaveLength(1);
    expect(again.requested_at).toBe(first.requested_at);

    await jobs.run(0);
    await service.requestDerive('w1', 'pr1');
    expect(jobs.enqueued).toHaveLength(2);
  });

  it('a failed model call fails the attempt with its billed usage, keeps the previous intent, and the job does not throw', async () => {
    await derive();
    const before = (await service.state('w1', 'pr1')).intent!;

    const failing = new FailingLlm();
    resolveLlm = async () => failing;
    await derive(); // the job resolves: a thrown 5xx would be retried and paid again

    const state = await service.state('w1', 'pr1');
    expect(state.status).toBe('failed');
    expect(state.error).toEqual(expect.any(String));
    expect(state.error!.length).toBeGreaterThan(0);
    expect(state.tokens_in).toBe(900);
    expect(state.tokens_out).toBe(40);
    expect(state.cost_usd).toBe(0.0004);
    expect(state.intent).toEqual(before);
    expect(structuredCalls(failing)).toHaveLength(1);
  });

  it('a missing key (ConfigError) fails the attempt instead of throwing out of the job', async () => {
    resolveLlm = async () => {
      throw new ConfigError('OPENROUTER_API_KEY is not configured');
    };
    await service.requestDerive('w1', 'pr1');
    await expect(jobs.run(0)).resolves.toBeUndefined();

    const state = await service.state('w1', 'pr1');
    expect(state.status).toBe('failed');
    expect(state.error).toEqual(expect.any(String));
    expect(state.intent).toBeNull();
  });

  it('a failing enqueue fails the attempt and rethrows', async () => {
    jobs.failWith = new Error('shutting down');
    await expect(service.requestDerive('w1', 'pr1')).rejects.toThrow('shutting down');
    expect(store.rows.get('pr1')).toMatchObject({ status: 'failed' });
  });

  it('a malformed job payload is a 422 and writes nothing', async () => {
    for (const bad of [null, {}, { prId: 5, workspaceId: 'w1' }, { prId: 'pr1' }]) {
      await expect(service.runJob(bad)).rejects.toBeInstanceOf(ValidationError);
    }
    expect(store.rows.size).toBe(0);
    expect(structuredCalls(llm)).toHaveLength(0);
  });

  it('a job whose row is gone is a no-op: no model call', async () => {
    await service.runJob({ workspaceId: 'w1', prId: 'pr1' });
    expect(store.rows.size).toBe(0);
    expect(structuredCalls(llm)).toHaveLength(0);
  });

  it('reapInterrupted fails the attempts a previous process left active', async () => {
    await service.requestDerive('w1', 'pr1');
    expect(await service.reapInterrupted()).toBe(1);
    const state = await service.state('w1', 'pr1');
    expect(state.status).toBe('failed');
    expect(state.error).toMatch(/^The API restarted/);
  });

  it('state turns stale when the head moves or the description changes (and not before)', async () => {
    await derive();
    expect(await service.state('w1', 'pr1')).toMatchObject({ stale: false, stale_reason: null });

    pulls.pull = { ...pulls.pull, headSha: 'ffff0000' };
    expect(await service.state('w1', 'pr1')).toMatchObject({ stale: true, stale_reason: 'head_changed' });

    pulls.pull = { ...pulls.pull, headSha: 'a1b2c3d4', body: 'A completely different description.' };
    expect(await service.state('w1', 'pr1')).toMatchObject({ stale: true, stale_reason: 'description_changed' });
  });

  describe('forReview (pre-work of a review run)', () => {
    const quiet = { info: () => undefined };
    const ctx = () => ({ diff: parseUnifiedDiff(DIFF), log: quiet });

    it('a fresh result is returned as it is, with no model call', async () => {
      useGithub({ detail: { body: 'Add a limiter to the public endpoints.' } });
      build();
      await derive();
      const calls = structuredCalls(llm).length;

      const out = await service.forReview('w1', pulls.pull, ctx());
      expect(out.intent).toEqual({
        summary: 'Adds rate limiting to the public API.',
        in_scope: ['src/config.ts'],
        out_of_scope: ['authentication'],
        confidence: 'medium',
        stale: false,
      });
      expect(structuredCalls(llm)).toHaveLength(calls);
    });

    it('a result for an older head comes back stale, still with no model call', async () => {
      await derive();
      const calls = structuredCalls(llm).length;

      const out = await service.forReview('w1', { ...pulls.pull, headSha: 'ffff0000' }, ctx());
      expect(out.intent).toMatchObject({ summary: 'Adds rate limiting to the public API.', stale: true });
      expect(structuredCalls(llm)).toHaveLength(calls);
    });

    it('while a re-derive runs, the previous result is still returned', async () => {
      await derive();
      await service.requestDerive('w1', 'pr1');
      const calls = structuredCalls(llm).length;

      const out = await service.forReview('w1', pulls.pull, ctx());
      expect(out.intent).toMatchObject({ summary: 'Adds rate limiting to the public API.', stale: false });
      expect(structuredCalls(llm)).toHaveLength(calls);
    });

    it('with no result and no attempt it derives inline, stores it, and returns the refreshed body for a PR without one', async () => {
      pulls.pull = { ...pulls.pull, body: null };
      useGithub({ detail: { body: 'REMOTE-BODY with no links.' } });
      build();

      const out = await service.forReview('w1', pulls.pull, ctx());
      expect(out.intent).toMatchObject({ summary: 'Adds rate limiting to the public API.', confidence: 'medium', stale: false });
      expect(out.body).toBe('REMOTE-BODY with no links.');
      expect(structuredCalls(llm)).toHaveLength(1);
      expect(store.rows.get('pr1')).toMatchObject({ status: 'done' });
      expect(jobs.enqueued).toEqual([]);
    });

    it('does not re-read a description the PR already has', async () => {
      pulls.pull = { ...pulls.pull, body: 'LOCAL-BODY' };
      useGithub({ detail: { body: 'REMOTE-BODY' } });
      build();

      const out = await service.forReview('w1', pulls.pull, ctx());
      expect(out.body).toBe('LOCAL-BODY');
      expect(promptOf(llm).all).toContain('LOCAL-BODY');
      expect(promptOf(llm).all).not.toContain('REMOTE-BODY');
    });

    it('an attempt in flight without a result gives null and no second call', async () => {
      await service.requestDerive('w1', 'pr1');

      const out = await service.forReview('w1', pulls.pull, ctx());
      expect(out.intent).toBeNull();
      expect(structuredCalls(llm)).toHaveLength(0);
      expect(store.rows.get('pr1')).toMatchObject({ status: 'queued' });
    });

    it('any failure gives null instead of throwing, so the review goes on', async () => {
      const failing = new FailingLlm();
      resolveLlm = async () => failing;

      const out = await service.forReview('w1', pulls.pull, ctx());
      expect(out.intent).toBeNull();
      expect(store.rows.get('pr1')).toMatchObject({ status: 'failed' });

      resolveLlm = async () => {
        throw new ConfigError('OPENROUTER_API_KEY is not configured');
      };
      store.rows.clear();
      await expect(service.forReview('w1', pulls.pull, ctx())).resolves.toMatchObject({ intent: null });
    });
  });

  it('logs one "intent: classified" line and never the description, a source body, a diff line, a query string or the model output', async () => {
    fetcher = new MockUrlFetcher({
      'https://example.com/spec.md?token=abc123': { body: 'SECRET-SOURCE-BODY' },
      'https://example.com/spec.md': { body: 'SECRET-SOURCE-BODY' },
    });
    useGithub({
      detail: { body: 'SECRET-DESC-PHRASE. Spec: https://example.com/spec.md?token=abc123 and #5' },
      issues: { 5: { number: 5, title: 'Issue five', body: 'SECRET-ISSUE-BODY', state: 'open' } },
    });
    llm = llmWith({ ...FIXTURE, summary: 'UNIQUE-MODEL-SUMMARY' });
    build();
    await derive();

    const classified = log.entries.filter((e) => e.msg === 'intent: classified');
    expect(classified).toHaveLength(1);
    expect(classified[0]!.obj).toMatchObject({ prId: 'pr1' });
    const logged = JSON.stringify(log.entries);
    for (const secret of ['SECRET-DESC-PHRASE', 'SECRET-SOURCE-BODY', 'SECRET-ISSUE-BODY', 'stripeKey', 'oldKey', '?token=', 'abc123', 'UNIQUE-MODEL-SUMMARY']) {
      expect(logged, secret).not.toContain(secret);
    }
  });
});
