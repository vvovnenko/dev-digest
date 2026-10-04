import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FeatureModelChoice, LLMProvider, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { LlmCallError } from '@devdigest/reviewer-core';
import { ConventionsService } from '../src/modules/conventions/service.js';
import {
  isActiveScan,
  type ConventionPatch,
  type ConventionRecord,
  type ConventionRepo,
  type ConventionScanFailure,
  type ConventionScanRecord,
  type ConventionScanResult,
  type ConventionExtraction,
  type FinalCandidate,
  type NewConventionScan,
} from '../src/modules/conventions/domain.js';
import type {
  ConventionSkillWriter,
  ConventionStore,
  CreatedSkill,
  JobQueue,
  NewConventionSkill,
} from '../src/modules/conventions/ports.js';
import { MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { AppError, ConfigError, ConflictError, NotFoundError, ValidationError } from '../src/platform/errors.js';

/**
 * In-memory ConventionStore: workspace-scoped rows, the (repo, fingerprint)
 * unique index and the one-active-scan-per-repo partial index emulated.
 */
class FakeConventionStore implements ConventionStore {
  rows: ConventionRecord[] = [];
  scans: ConventionScanRecord[] = [];
  private seq = 0;

  private of(ws: string, repoId: string) {
    return this.rows
      .filter((r) => r.workspaceId === ws && r.repoId === repoId)
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  }
  private scansOf(ws: string, repoId: string) {
    return this.scans.filter((s) => s.workspaceId === ws && s.repoId === repoId);
  }
  private scan(ws: string, id: string) {
    return this.scans.find((s) => s.workspaceId === ws && s.id === id);
  }
  async latestScan(ws: string, repoId: string) {
    return this.scansOf(ws, repoId).at(-1);
  }
  async latestDoneScan(ws: string, repoId: string) {
    return this.scansOf(ws, repoId)
      .filter((s) => s.status === 'done')
      .at(-1);
  }
  async activeScan(ws: string, repoId: string) {
    return this.scansOf(ws, repoId).find((s) => isActiveScan(s.status));
  }
  async insertQueuedScan(scan: NewConventionScan): Promise<ConventionScanRecord | 'active_exists'> {
    if (this.scans.some((s) => s.repoId === scan.repoId && isActiveScan(s.status))) return 'active_exists';
    const row: ConventionScanRecord = {
      ...scan,
      id: `scan${++this.seq}`,
      status: 'queued',
      error: null,
      jobId: null,
      sampleFiles: [],
      tokensIn: 0,
      tokensOut: 0,
      costUsd: null,
      candidatesFound: 0,
      candidatesKept: 0,
      dropped: [],
      createdAt: new Date(),
      startedAt: null,
      finishedAt: null,
    };
    this.scans.push(row);
    return row;
  }
  async setJobId(ws: string, id: string, jobId: string) {
    const scan = this.scan(ws, id);
    if (scan) scan.jobId = jobId;
  }
  async markRunning(ws: string, id: string) {
    const scan = this.scan(ws, id);
    if (!scan || !isActiveScan(scan.status)) return undefined;
    return Object.assign(scan, { status: 'running' as const, startedAt: new Date() });
  }
  async completeScan(ws: string, id: string, result: ConventionScanResult, candidates: FinalCandidate[]) {
    const scan = this.scan(ws, id);
    if (!scan || scan.status !== 'running') return undefined;
    this.rows = this.rows.filter((r) => !(r.workspaceId === ws && r.repoId === scan.repoId && r.status === 'pending'));
    let kept = 0;
    for (const c of candidates) {
      if (this.rows.some((r) => r.repoId === scan.repoId && r.fingerprint === c.fingerprint)) continue;
      kept++;
      this.rows.push({
        id: `c${++this.seq}`,
        workspaceId: ws,
        repoId: scan.repoId,
        category: c.category,
        rule: c.rule,
        evidencePath: c.path,
        evidenceStartLine: c.startLine,
        evidenceEndLine: c.endLine,
        evidenceSnippet: c.snippet,
        confidence: c.confidence,
        accepted: false,
        status: 'pending',
        fingerprint: c.fingerprint,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    return Object.assign(scan, result, {
      candidatesKept: kept,
      status: 'done' as const,
      error: null,
      finishedAt: new Date(),
    });
  }
  async failScan(ws: string, id: string, failure: ConventionScanFailure) {
    const scan = this.scan(ws, id);
    if (!scan || !isActiveScan(scan.status)) return;
    const { usage } = failure;
    Object.assign(scan, {
      status: 'failed' as const,
      error: failure.error,
      finishedAt: new Date(),
      ...(usage && { tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, costUsd: usage.costUsd }),
    });
  }
  async reapActiveScans(error: string) {
    const active = this.scans.filter((s) => isActiveScan(s.status));
    for (const s of active) Object.assign(s, { status: 'failed' as const, error, finishedAt: new Date() });
    return active.length;
  }
  async update(ws: string, id: string, patch: ConventionPatch) {
    const row = this.rows.find((r) => r.id === id && r.workspaceId === ws);
    if (!row) return undefined;
    Object.assign(row, patch, { updatedAt: new Date() });
    return row;
  }
  async resetAccepted(ws: string, repoId: string) {
    const accepted = await this.listAccepted(ws, repoId);
    for (const r of accepted) Object.assign(r, { status: 'pending', accepted: false });
    return accepted.length;
  }
  async listVisible(ws: string, repoId: string) {
    return this.of(ws, repoId).filter((r) => r.status !== 'rejected');
  }
  async listAccepted(ws: string, repoId: string) {
    return this.of(ws, repoId).filter((r) => r.status === 'accepted');
  }
  async listDecided(ws: string, repoId: string) {
    return this.of(ws, repoId).filter((r) => r.status !== 'pending');
  }
}

/** The JobRunner as the service sees it: records registrations and enqueues; a test runs a job's handler. */
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

class FakeSkillWriter implements ConventionSkillWriter {
  created: { values: NewConventionSkill; note: string }[] = [];
  async nameExists(ws: string, name: string) {
    return this.created.some((c) => c.values.workspaceId === ws && c.values.name === name);
  }
  async insert(values: NewConventionSkill, note: string): Promise<CreatedSkill | 'name_taken'> {
    if (await this.nameExists(values.workspaceId, values.name)) return 'name_taken';
    this.created.push({ values, note });
    return { ...values, id: `s${this.created.length}`, version: 1 };
  }
}

/** A provider whose call fails after billing, as reviewer-core's providers report it. */
class FailingLlm extends MockLLMProvider {
  constructor(private error: unknown) {
    super('openrouter');
  }
  override async completeStructured<T>(): Promise<StructuredResult<T>> {
    throw this.error;
  }
}

const FILES = {
  'tsconfig.json': '{ "compilerOptions": { "strict": true } }\n',
  'src/api/users.ts': [
    "import { NotFoundError } from '../errors.js';",
    '',
    'export async function getUser(id: string) {',
    '  const user = await db.find(id);',
    "  if (!user) throw new NotFoundError('User not found');",
    '  return user;',
    '}',
  ].join('\n'),
  'src/api/teams.ts': "export const listTeams = async () => db.teams.all();\n",
  'src/lib/extra.ts': 'export const helperValue = computeHelper();\n',
};

type Candidate = ConventionExtraction['candidates'][number];
const cand = (rule: string, file: string, line: number, snippet: string, confidence = 0.8): Candidate => ({
  category: 'error_handling',
  rule,
  evidence: { file, line, end_line: null, snippet },
  confidence,
});

const THROW_RULE = cand('Throw NotFoundError when a row is missing', 'src/api/users.ts', 5, "if (!user) throw new NotFoundError('User not found');", 0.9);
const ARROW_RULE = cand('Export async arrow functions', 'src/api/teams.ts', 1, 'export const listTeams = async () => db.teams.all();', 0.7);
const GHOST_RULE = cand('Wrap handlers in tryCatch', 'src/ghost.ts', 3, 'return tryCatch(handler);', 0.95);

const REPO: ConventionRepo = { id: 'r1', owner: 'acme', name: 'payments-api', clonePath: '/clones/acme/payments-api' };

describe('ConventionsService', () => {
  let store: FakeConventionStore;
  let skills: FakeSkillWriter;
  let jobs: FakeJobQueue;
  let repos: Map<string, ConventionRepo & { workspaceId: string }>;
  let top: string[];
  let llm: MockLLMProvider;
  let choice: FeatureModelChoice;
  let resolveLlm: (provider: string) => Promise<LLMProvider>;
  let service: ConventionsService;

  const setLlm = (candidates: Candidate[]) => {
    llm = new MockLLMProvider('openrouter', { structuredBySchema: { ConventionExtraction: { candidates } } });
  };

  beforeEach(() => {
    store = new FakeConventionStore();
    skills = new FakeSkillWriter();
    jobs = new FakeJobQueue();
    repos = new Map([[REPO.id, { ...REPO, workspaceId: 'w1' }]]);
    top = ['src/api/users.ts', 'src/api/teams.ts'];
    choice = { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' };
    setLlm([THROW_RULE, ARROW_RULE, GHOST_RULE]);
    resolveLlm = async () => llm;
    service = new ConventionsService({
      store,
      repos: { getById: async (ws, id) => (repos.get(id)?.workspaceId === ws ? repos.get(id) : undefined) },
      samples: { getConventionSamples: async () => top },
      files: () => new MockGitClient({ files: FILES }),
      llm: (provider) => resolveLlm(provider),
      model: async () => choice,
      skills,
      jobs,
    });
    service.registerScanJobHandler();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const lastRequest = () =>
    llm.calls.filter((c) => c.method === 'completeStructured').at(-1)!.req as StructuredRequest<unknown>;

  /** POST then the job, as the JobRunner would run it; the state a poll then reads. */
  const scanNow = async (ws = 'w1', repoId = 'r1') => {
    const before = jobs.enqueued.length;
    await service.startScan(ws, repoId);
    expect(jobs.enqueued).toHaveLength(before + 1);
    await jobs.run(before);
    return service.state(ws, repoId);
  };

  it('samples configs + top files, grounds the evidence and drops a hallucinated file', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const state = await scanNow();
    expect(state.scan).toMatchObject({
      status: 'done',
      error: null,
      sample_files: ['tsconfig.json', 'src/api/users.ts', 'src/api/teams.ts'],
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      candidates_found: 3,
      candidates_kept: 2,
      cost_usd: 0.001,
    });
    expect(state.latest_scan).toEqual(state.scan);
    expect(state.candidates).toEqual([
      expect.objectContaining({
        rule: 'Throw NotFoundError when a row is missing',
        evidence_path: 'src/api/users.ts',
        evidence_start_line: 5,
        evidence_end_line: 5,
        evidence_snippet: "  if (!user) throw new NotFoundError('User not found');",
        confidence: 0.9,
        status: 'pending',
        accepted: false,
      }),
      expect.objectContaining({ rule: 'Export async arrow functions', confidence: 0.7 }),
    ]);
    expect(store.scans[0]!.dropped).toEqual([{ rule: 'Wrap handlers in tryCatch', reason: 'file_missing' }]);
    expect(store.scans[0]).toMatchObject({ tokensIn: 100, tokensOut: 50 });

    const req = lastRequest();
    expect(req).toMatchObject({ model: 'deepseek/deepseek-v4-flash', schemaName: 'ConventionExtraction', maxRetries: 1 });
    // The default model's hidden reasoning counts against the cap; 6000 cut scans off.
    expect(req.maxTokens).toBe(12_000);
    // Aborted before the JobRunner's 120 s job timeout gives up on the handler.
    expect(req.signal).toBeInstanceOf(AbortSignal);
    expect(timeout).toHaveBeenCalledWith(110_000);
    const user = req.messages.find((m) => m.role === 'user')!.content;
    expect(user).toContain('<untrusted source="src/api/users.ts">');
    expect(user).toContain("   5|   if (!user) throw new NotFoundError('User not found');");
    expect(user.indexOf('tsconfig.json')).toBeLessThan(user.indexOf('src/api/users.ts'));
  });

  it('startScan queues one scan and enqueues its job once, with the repo in the payload', async () => {
    const state = await service.startScan('w1', 'r1');
    expect(state.scan).toBeNull();
    expect(state.latest_scan).toMatchObject({
      status: 'queued',
      error: null,
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      started_at: null,
      finished_at: null,
    });
    const scanId = state.latest_scan!.id;
    expect(jobs.enqueued).toEqual([
      { id: 'job1', workspaceId: 'w1', kind: 'conventions-scan', payload: { scanId, repoId: 'r1', workspaceId: 'w1' } },
    ]);
    expect(store.scans[0]!.jobId).toBe('job1');
    // Nothing is sent to the model until the job runs.
    expect(llm.calls).toEqual([]);
  });

  it('a start while a scan is queued or running returns that scan and enqueues nothing', async () => {
    const queued = await service.startScan('w1', 'r1');
    expect((await service.startScan('w1', 'r1')).latest_scan!.id).toBe(queued.latest_scan!.id);
    expect(jobs.enqueued).toHaveLength(1);

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    resolveLlm = async () => {
      await gate;
      return llm;
    };
    const job = jobs.run(0);
    await new Promise((r) => setTimeout(r, 0));
    const running = await service.startScan('w1', 'r1');
    expect(running.latest_scan).toMatchObject({ id: queued.latest_scan!.id, status: 'running' });
    expect(running.latest_scan!.started_at).toEqual(expect.any(String));
    expect(jobs.enqueued).toHaveLength(1);
    release();
    await job;

    // Lost race: the check saw no active scan, the partial unique index did.
    const second = await service.startScan('w1', 'r1');
    vi.spyOn(store, 'activeScan').mockResolvedValueOnce(undefined);
    expect((await service.startScan('w1', 'r1')).latest_scan!.id).toBe(second.latest_scan!.id);
    expect(jobs.enqueued).toHaveLength(2);
    expect(store.scans.filter((s) => isActiveScan(s.status))).toHaveLength(1);
  });

  it('runScan moves the scan queued → running → done and records its result', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    resolveLlm = async () => {
      await gate;
      return llm;
    };
    const { latest_scan: queued } = await service.startScan('w1', 'r1');
    expect(queued!.status).toBe('queued');
    const job = jobs.run(0);
    await new Promise((r) => setTimeout(r, 0));
    expect((await service.state('w1', 'r1')).latest_scan).toMatchObject({ status: 'running', finished_at: null });
    release();
    await expect(job).resolves.toBeUndefined();

    const done = await service.state('w1', 'r1');
    expect(done.latest_scan).toMatchObject({ id: queued!.id, status: 'done', candidates_kept: 2 });
    expect(done.latest_scan!.finished_at).toEqual(expect.any(String));
    expect(done.scan).toEqual(done.latest_scan);
    expect(done.candidates).toHaveLength(2);
  });

  it('checks a cited file the scan did not sample against that file', async () => {
    setLlm([cand('Name helpers helperX', 'src/lib/extra.ts', 1, 'export const helperValue = computeHelper();')]);
    const state = await scanNow();
    expect(state.candidates.map((c) => c.evidence_path)).toEqual(['src/lib/extra.ts']);
  });

  it('uses the Settings model and its provider, chosen when the scan is queued', async () => {
    choice = { provider: 'openai', model: 'gpt-4.1-mini' };
    let asked = '';
    resolveLlm = async (provider) => {
      asked = provider;
      return llm;
    };
    const queued = await service.startScan('w1', 'r1');
    expect(queued.latest_scan).toMatchObject({ provider: 'openai', model: 'gpt-4.1-mini' });
    await jobs.run(0);
    const state = await service.state('w1', 'r1');
    expect(asked).toBe('openai');
    expect(state.scan).toMatchObject({ provider: 'openai', model: 'gpt-4.1-mini' });
    expect(lastRequest().model).toBe('gpt-4.1-mini');
  });

  it('refuses a repo that is not cloned or not indexed (409) and queues nothing', async () => {
    repos.set('r2', { ...REPO, id: 'r2', clonePath: null, workspaceId: 'w1' });
    await expect(service.startScan('w1', 'r2')).rejects.toMatchObject({ statusCode: 409, details: { reason: 'not_cloned' } });

    top = [];
    await expect(service.startScan('w1', 'r1')).rejects.toMatchObject({ statusCode: 409, details: { reason: 'not_indexed' } });
    expect(store.scans).toEqual([]);
    expect(jobs.enqueued).toEqual([]);
  });

  it('a failed model call fails the scan with its message and billed usage; the handler resolves', async () => {
    const before = await scanNow();
    resolveLlm = async () =>
      new FailingLlm(new LlmCallError('upstream 503', { tokensIn: 900, tokensOut: 40, costUsd: 0.0004 }));
    await service.startScan('w1', 'r1');
    await expect(jobs.run(1)).resolves.toBeUndefined();

    const state = await service.state('w1', 'r1');
    expect(state.latest_scan).toMatchObject({
      status: 'failed',
      error: 'The conventions model call failed: upstream 503',
      cost_usd: 0.0004,
    });
    expect(state.latest_scan!.finished_at).toEqual(expect.any(String));
    expect(store.scans[1]).toMatchObject({ tokensIn: 900, tokensOut: 40 });
    // The last good scan and its candidates stay what the page shows.
    expect(state.scan).toEqual(before.scan);
    expect(state.candidates).toEqual(before.candidates);

    // An adapter's own AppError keeps its message and the usage it carries.
    const adapterError = Object.assign(new AppError('external_service_error', 'schema validation failed', 502), {
      usage: { tokensIn: 7, tokensOut: 3, costUsd: null },
    });
    resolveLlm = async () => new FailingLlm(adapterError);
    await service.startScan('w1', 'r1');
    await expect(jobs.run(2)).resolves.toBeUndefined();
    expect(store.scans[2]).toMatchObject({ status: 'failed', error: 'schema validation failed', tokensIn: 7, tokensOut: 3 });

    const timedOut = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    resolveLlm = async () => new FailingLlm(timedOut);
    await service.startScan('w1', 'r1');
    await expect(jobs.run(3)).resolves.toBeUndefined();
    expect(store.scans[3]).toMatchObject({
      status: 'failed',
      error: 'The conventions model did not answer within 110 s',
      tokensIn: 0,
      costUsd: null,
    });
  });

  it('a missing key or a vanished index fails the scan without throwing, and the next scan runs', async () => {
    resolveLlm = async () => {
      throw new ConfigError('OPENROUTER_API_KEY is not configured');
    };
    await service.startScan('w1', 'r1');
    await expect(jobs.run(0)).resolves.toBeUndefined();
    expect((await service.state('w1', 'r1')).latest_scan).toMatchObject({
      status: 'failed',
      error: 'OPENROUTER_API_KEY is not configured',
    });

    resolveLlm = async () => llm;
    await service.startScan('w1', 'r1');
    top = [];
    await expect(jobs.run(1)).resolves.toBeUndefined();
    expect(store.scans[1]).toMatchObject({
      status: 'failed',
      error: 'The repo has no indexed files yet — wait for indexing to finish',
    });
    expect(llm.calls).toEqual([]);

    top = ['src/api/users.ts', 'src/api/teams.ts'];
    await expect(scanNow()).resolves.toMatchObject({ scan: { status: 'done', candidates_kept: 2 } });
  });

  it('a failed enqueue fails the scan and rethrows, so the repo is not left holding it', async () => {
    jobs.failWith = new AppError('shutting_down', 'The API is shutting down; no new jobs are accepted', 503);
    await expect(service.startScan('w1', 'r1')).rejects.toMatchObject({ statusCode: 503, code: 'shutting_down' });
    expect(store.scans[0]).toMatchObject({
      status: 'failed',
      error: 'The API is shutting down; no new jobs are accepted',
    });

    jobs.failWith = null;
    await expect(scanNow()).resolves.toMatchObject({ scan: { status: 'done' } });
  });

  it('reapInterrupted fails every queued and running scan; a reaped scan’s job then does nothing', async () => {
    repos.set('r3', { ...REPO, id: 'r3', workspaceId: 'w2' });
    await scanNow();
    await service.startScan('w1', 'r1');
    await service.startScan('w2', 'r3');
    await store.markRunning('w2', store.scans[2]!.id);

    expect(await service.reapInterrupted()).toBe(2);
    expect(store.scans.map((s) => [s.status, s.error])).toEqual([
      ['done', null],
      ['failed', 'The API restarted while this scan was running'],
      ['failed', 'The API restarted while this scan was running'],
    ]);
    expect(await service.reapInterrupted()).toBe(0);

    const calls = llm.calls.length;
    await expect(jobs.run(1)).resolves.toBeUndefined();
    expect(llm.calls).toHaveLength(calls);
    expect(store.scans[1]!.status).toBe('failed');
  });

  it('a malformed job payload is a 422 the JobRunner does not retry', async () => {
    const handler = jobs.handlers.get('conventions-scan')!;
    await expect(handler({ scanId: 'scan1' }, { jobId: 'job1' })).rejects.toBeInstanceOf(ValidationError);
    await expect(handler(null, { jobId: 'job1' })).rejects.toMatchObject({ statusCode: 422 });
  });

  it('a repo of another workspace is not found', async () => {
    await expect(service.startScan('w2', 'r1')).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.state('w2', 'r1')).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.deselectAll('w2', 'r1')).rejects.toBeInstanceOf(NotFoundError);
    expect(jobs.enqueued).toEqual([]);
  });

  it('accept, reject and edit; a re-scan keeps decisions and never brings a rejected rule back', async () => {
    const first = await scanNow();
    const [throwRule, arrowRule] = first.candidates;
    expect(await service.update('w1', throwRule!.id, { status: 'accepted' })).toMatchObject({ status: 'accepted', accepted: true });
    await service.update('w1', arrowRule!.id, { status: 'rejected' });
    const edited = await service.update('w1', throwRule!.id, { rule: '  Throw NotFoundError for missing rows ' });
    expect(edited).toMatchObject({ rule: 'Throw NotFoundError for missing rows', status: 'accepted', accepted: true });
    await expect(service.update('w2', throwRule!.id, { status: 'rejected' })).rejects.toBeInstanceOf(NotFoundError);

    expect((await service.state('w1', 'r1')).candidates.map((c) => c.id)).toEqual([throwRule!.id]);

    // The model proposes all three again (one reworded only in case/punctuation) plus a new one.
    setLlm([
      THROW_RULE,
      { ...ARROW_RULE, rule: 'export async ARROW functions.' },
      cand('Import errors from ../errors.js', 'src/api/users.ts', 1, "import { NotFoundError } from '../errors.js';", 0.6),
    ]);
    const second = await scanNow();
    expect(second.candidates.map((c) => [c.rule, c.status])).toEqual([
      ['Throw NotFoundError for missing rows', 'accepted'],
      ['Import errors from ../errors.js', 'pending'],
    ]);
    expect(second.scan).toMatchObject({ candidates_found: 3, candidates_kept: 1 });
    const decided = lastRequest().messages.find((m) => m.role === 'user')!.content;
    expect(decided).toContain('<untrusted source="decided">');
    expect(decided).toContain('- Export async arrow functions');

    expect(await service.deselectAll('w1', 'r1')).toEqual({ updated: 1 });
    expect((await service.state('w1', 'r1')).candidates.every((c) => c.status === 'pending')).toBe(true);
  });

  it('drafts and creates the skill from the accepted candidates only', async () => {
    const { candidates } = await scanNow();
    await expect(service.skillDraft('w1', 'r1')).rejects.toMatchObject({
      statusCode: 422,
      details: { reason: 'no_accepted_conventions' },
    });
    await expect(service.createSkill('w1', 'r1', { name: 'x', body: 'y' })).rejects.toBeInstanceOf(ValidationError);

    for (const c of candidates) await service.update('w1', c.id, { status: 'accepted' });
    const draft = await service.skillDraft('w1', 'r1');
    expect(draft).toMatchObject({
      name: 'payments-api-conventions',
      description: '2 house conventions extracted from payments-api',
      type: 'convention',
      accepted_count: 2,
      name_taken: false,
    });
    expect(draft.body).toContain('Detected in `src/api/users.ts:5`:');

    const skill = await service.createSkill('w1', 'r1', { name: draft.name, body: `${draft.body}\n\nEdited.` });
    expect(skill).toMatchObject({
      name: 'payments-api-conventions',
      source: 'extracted',
      type: 'convention',
      description: '',
      enabled: true,
      version: 1,
      evidence_files: ['src/api/users.ts', 'src/api/teams.ts'],
      agent_count: 0,
    });
    expect(skills.created[0]!.note).toBe('Created from 2 conventions in payments-api');
    expect((await service.skillDraft('w1', 'r1')).name_taken).toBe(true);

    const taken = service.createSkill('w1', 'r1', { name: draft.name, body: 'again' });
    await expect(taken).rejects.toBeInstanceOf(ConflictError);
    await expect(service.createSkill('w1', 'r1', { name: draft.name, body: 'again' })).rejects.toMatchObject({
      message: 'A skill named "payments-api-conventions" already exists',
      details: { field: 'name' },
    });
  });
});
