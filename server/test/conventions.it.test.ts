import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  ConventionCandidate,
  ConventionSkillDraft,
  ConventionsState,
  Skill,
  SkillVersion,
  type LLMProvider,
  type StructuredRequest,
  type StructuredResult,
} from '@devdigest/shared';
import { LlmCallError } from '@devdigest/reviewer-core';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { isUniqueViolation } from '../src/db/pg-errors.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider, MockSecretsProvider } from '../src/adapters/mocks.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';
import type { ConventionExtraction } from '../src/modules/conventions/domain.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[conventions] Docker not available — skipping integration tests.');
}

type Candidate = ConventionExtraction['candidates'][number];
const cand = (rule: string, file: string, line: number, snippet: string, confidence: number): Candidate => ({
  category: 'error_handling',
  rule,
  evidence: { file, line, end_line: null, snippet },
  confidence,
});

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
  'src/api/teams.ts': 'export const listTeams = async () => db.teams.all();\n',
};
const TOP = ['src/api/users.ts', 'src/api/teams.ts'];

const THROW_RULE = cand('Throw NotFoundError when a row is missing', 'src/api/users.ts', 5, "if (!user) throw new NotFoundError('User not found');", 0.9);
const ARROW_RULE = cand('Export async arrow functions', 'src/api/teams.ts', 1, 'export const listTeams = async () => db.teams.all();', 0.7);
const GHOST_RULE = cand('Wrap handlers in tryCatch', 'src/ghost.ts', 3, 'return tryCatch(handler);', 0.95);
const IMPORT_RULE = cand('Import errors from ../errors.js', 'src/api/users.ts', 1, "import { NotFoundError } from '../errors.js';", 0.6);

/** repo-intel stand-in: the ranked files come from the test; nothing else may be called. */
function repoIntelStub(): RepoIntel {
  const unused = async (): Promise<never> => {
    throw new Error('not used by the conventions tests');
  };
  return {
    indexRepo: unused,
    refreshIndex: unused,
    getIndexState: unused,
    getBlastRadius: unused,
    getRepoMap: unused,
    getFileRank: unused,
    getSymbolsInFiles: unused,
    getCallerSignatures: unused,
    getUnresolvedReferences: unused,
    getConventionSamples: async () => TOP,
    getTopFilesByRank: unused,
    getCriticalPaths: unused,
  };
}

/** The mock model, able to hold its calls — to look at a scan while it runs. */
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

/** A model call that fails after billing, as reviewer-core's providers report it. */
class FailingLlm extends MockLLMProvider {
  override async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ method: 'completeStructured', req });
    throw new LlmCallError('upstream 503', { tokensIn: 900, tokensOut: 40, costUsd: 0.0004 });
  }
}

/**
 * Conventions over a real Postgres: a scan is queued (202), runs as a JobRunner
 * job and persists; one active scan per repo; a restart fails the scans it
 * interrupted; decisions survive a re-scan, the accepted candidates become an
 * `extracted` skill, the guards (404 / 409 / 422) hold, and the Settings model
 * is the one a scan runs on. Every provider is a mock — no real model call.
 */
d('/repos/:id/conventions (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
    const [repo] = await pg.handle.db
      .update(t.repos)
      .set({ clonePath: '/mock/clones/acme/payments-api' })
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')))
      .returning();
    repoId = repo!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp(
    candidates: Candidate[],
    providers: { openai?: LLMProvider; openrouter?: LLMProvider } = {},
  ) {
    const openrouter = new GatedLlm('openrouter', { structuredBySchema: { ConventionExtraction: { candidates } } });
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const app = buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ files: FILES }),
        github: new MockGitHubClient(),
        secrets: new MockSecretsProvider(),
        repoIntel: repoIntelStub(),
        llm: { openrouter: providers.openrouter ?? openrouter, openai: providers.openai ?? new MockLLMProvider('openai') },
      },
    });
    return { app, openrouter };
  }

  /** Another cloned repo of the seeded workspace, so a test's scans don't touch the shared one. */
  async function newRepo(name: string): Promise<string> {
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath: `/mock/clones/acme/${name}` })
      .returning();
    return repo!.id;
  }

  const scanRows = (repo: string) =>
    pg.handle.db.select().from(t.conventionScans).where(eq(t.conventionScans.repoId, repo));

  type App = Awaited<ReturnType<typeof makeApp>['app']>;
  const state = async (app: App, repo = repoId) => {
    const res = await app.inject({ method: 'GET', url: `/repos/${repo}/conventions` });
    expect(res.statusCode).toBe(200);
    return ConventionsState.parse(res.json());
  };
  const extract = (app: App, repo = repoId) =>
    app.inject({ method: 'POST', url: `/repos/${repo}/conventions/extract` });
  /** POST (202), then wait for the scan job; the state the next poll reads. */
  const scanNow = async (app: App, repo = repoId) => {
    const res = await extract(app, repo);
    expect(res.statusCode).toBe(202);
    await app.container.jobs.onIdle();
    return state(app, repo);
  };
  const put = (app: App, id: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'PUT', url: `/conventions/${id}`, payload });

  it('queues a scan (202), runs it as a job, keeps only grounded candidates and persists them across a new app instance', async () => {
    const first = makeApp([THROW_RULE, ARROW_RULE, GHOST_RULE]);
    const app = await first.app;
    expect(await state(app)).toEqual({ scan: null, latest_scan: null, candidates: [] });

    first.openrouter.hold();
    const res = await extract(app);
    expect(res.statusCode).toBe(202);
    const queued = ConventionsState.parse(res.json());
    expect(queued.scan).toBeNull();
    expect(queued.candidates).toEqual([]);
    expect(['queued', 'running']).toContain(queued.latest_scan!.status);
    expect(queued.latest_scan).toMatchObject({ provider: 'openrouter', model: 'deepseek/deepseek-v4-flash', finished_at: null });
    first.openrouter.release();
    await app.container.jobs.onIdle();

    const scanned = await state(app);
    expect(scanned.scan).toMatchObject({
      id: queued.latest_scan!.id,
      status: 'done',
      error: null,
      sample_files: ['tsconfig.json', 'src/api/users.ts', 'src/api/teams.ts'],
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      candidates_found: 3,
      candidates_kept: 2,
    });
    expect(scanned.scan!.started_at).toEqual(expect.any(String));
    expect(scanned.scan!.finished_at).toEqual(expect.any(String));
    expect(scanned.latest_scan).toEqual(scanned.scan);
    expect(scanned.candidates.map((c) => [c.rule, c.evidence_path, c.evidence_start_line, c.status])).toEqual([
      ['Throw NotFoundError when a row is missing', 'src/api/users.ts', 5, 'pending'],
      ['Export async arrow functions', 'src/api/teams.ts', 1, 'pending'],
    ]);
    expect(scanned.candidates[0]!.evidence_snippet).toBe("  if (!user) throw new NotFoundError('User not found');");
    const [scanRow] = await scanRows(repoId);
    expect(scanRow!.dropped).toEqual([{ rule: 'Wrap handlers in tryCatch', reason: 'file_missing' }]);
    // The job that ran it: serialised with the repo's other jobs through `repoId` in its payload.
    const [job] = await pg.handle.db.select().from(t.jobs).where(eq(t.jobs.id, scanRow!.jobId!));
    expect(job).toMatchObject({
      kind: 'conventions-scan',
      status: 'done',
      payload: { scanId: scanRow!.id, repoId, workspaceId },
    });
    await app.close();

    const again = await makeApp([]).app;
    expect(await state(again)).toEqual(scanned);
    await again.close();
  });

  it('reject hides a candidate, edits persist, and a re-scan keeps decisions without bringing a rejected rule back', async () => {
    const { app: built } = makeApp([THROW_RULE, { ...ARROW_RULE, rule: 'Export ASYNC arrow functions!' }, IMPORT_RULE]);
    const app = await built;
    const [throwRule, arrowRule] = (await state(app)).candidates;

    const accepted = await put(app, throwRule!.id, { status: 'accepted' });
    expect(ConventionCandidate.parse(accepted.json())).toMatchObject({ status: 'accepted', accepted: true });
    expect((await put(app, arrowRule!.id, { status: 'rejected' })).statusCode).toBe(200);
    const edited = await put(app, throwRule!.id, { rule: 'Throw NotFoundError for missing rows' });
    expect(edited.json()).toMatchObject({ rule: 'Throw NotFoundError for missing rows', status: 'accepted' });
    expect((await put(app, throwRule!.id, {})).statusCode).toBe(422);
    expect((await put(app, throwRule!.id, { rule: '   ' })).statusCode).toBe(422);
    expect((await put(app, 'not-a-uuid', { status: 'accepted' })).statusCode).toBe(422);
    expect((await put(app, '00000000-0000-0000-0000-000000000000', { status: 'accepted' })).statusCode).toBe(404);

    expect((await state(app)).candidates.map((c) => c.id)).toEqual([throwRule!.id]);

    const rescanned = await scanNow(app);
    expect(rescanned.candidates.map((c) => [c.rule, c.status, c.accepted])).toEqual([
      ['Throw NotFoundError for missing rows', 'accepted', true],
      ['Import errors from ../errors.js', 'pending', false],
    ]);
    expect(rescanned.scan).toMatchObject({ status: 'done', candidates_found: 3, candidates_kept: 1 });
    const rows = await pg.handle.db.select().from(t.conventions).where(eq(t.conventions.repoId, repoId));
    expect(rows.map((r) => [r.status, r.accepted]).sort()).toEqual([
      ['accepted', true],
      ['pending', false],
      ['rejected', false],
    ]);

    const reset = await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/deselect-all` });
    expect(reset.json()).toEqual({ updated: 1 });
    expect((await state(app)).candidates.every((c) => c.status === 'pending' && !c.accepted)).toBe(true);
    await app.close();
  });

  it('drafts and creates the skill: 422 with nothing accepted, 201 in /skills as extracted, 409 on a taken name', async () => {
    const app = await makeApp([]).app;
    const draftUrl = `/repos/${repoId}/conventions/skill-draft`;
    const createUrl = `/repos/${repoId}/conventions/skill`;

    const none = await app.inject({ method: 'GET', url: draftUrl });
    expect(none.statusCode).toBe(422);
    expect(none.json().error).toMatchObject({ code: 'validation_error', details: { reason: 'no_accepted_conventions' } });
    expect((await app.inject({ method: 'POST', url: createUrl, payload: { name: 'x', body: 'y' } })).statusCode).toBe(422);

    for (const c of (await state(app)).candidates) await put(app, c.id, { status: 'accepted' });
    const draft = ConventionSkillDraft.parse((await app.inject({ method: 'GET', url: draftUrl })).json());
    expect(draft).toMatchObject({ name: 'payments-api-conventions', type: 'convention', accepted_count: 2, name_taken: false });
    expect(draft.body).toContain('## throw-notfounderror-missing-rows\nThrow NotFoundError for missing rows');

    const created = await app.inject({
      method: 'POST',
      url: createUrl,
      payload: { name: draft.name, description: 'House rules.', type: draft.type, body: `${draft.body}\n\nEdited.`, enabled: false },
    });
    expect(created.statusCode).toBe(201);
    const skill = Skill.parse(created.json());
    expect(skill).toMatchObject({
      name: 'payments-api-conventions',
      description: 'House rules.',
      source: 'extracted',
      enabled: false,
      version: 1,
      evidence_files: ['src/api/users.ts'],
    });
    const listed = (await app.inject({ method: 'GET', url: '/skills' })).json() as Skill[];
    expect(listed.find((s) => s.id === skill.id)).toMatchObject({ source: 'extracted', body: `${draft.body}\n\nEdited.` });
    const [v1] = (await app.inject({ method: 'GET', url: `/skills/${skill.id}/versions` })).json() as SkillVersion[];
    expect(v1!.note).toBe('Created from 2 conventions in payments-api');

    expect(ConventionSkillDraft.parse((await app.inject({ method: 'GET', url: draftUrl })).json()).name_taken).toBe(true);
    const taken = await app.inject({ method: 'POST', url: createUrl, payload: { name: draft.name, body: 'again' } });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error).toMatchObject({
      code: 'conflict',
      message: 'A skill named "payments-api-conventions" already exists',
      details: { field: 'name' },
    });
    await app.close();
  });

  it('refuses a repo that is not cloned (409) and another workspace’s repo or candidate (404)', async () => {
    const app = await makeApp([THROW_RULE]).app;
    const { db } = pg.handle;
    const [uncloned] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'uncloned', fullName: 'acme/uncloned' })
      .returning();
    const notCloned = await app.inject({ method: 'POST', url: `/repos/${uncloned!.id}/conventions/extract` });
    expect(notCloned.statusCode).toBe(409);
    expect(notCloned.json().error).toMatchObject({ code: 'conflict', details: { reason: 'not_cloned' } });
    expect(await scanRows(uncloned!.id)).toEqual([]);

    const [ws] = await db.insert(t.workspaces).values({ name: `conventions-other-${Date.now()}` }).returning();
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId: ws!.id, owner: 'other', name: 'app', fullName: 'other/app', clonePath: '/x' })
      .returning();
    const [row] = await db
      .insert(t.conventions)
      .values({ workspaceId: ws!.id, repoId: repo!.id, rule: 'Foreign rule', fingerprint: 'foreign rule', confidence: 0.9 })
      .returning();
    const calls = [
      { method: 'GET', url: `/repos/${repo!.id}/conventions` },
      { method: 'POST', url: `/repos/${repo!.id}/conventions/extract` },
      { method: 'POST', url: `/repos/${repo!.id}/conventions/deselect-all` },
      { method: 'GET', url: `/repos/${repo!.id}/conventions/skill-draft` },
      { method: 'POST', url: `/repos/${repo!.id}/conventions/skill`, payload: { name: 'foreign-skill', body: 'x' } },
      { method: 'PUT', url: `/conventions/${row!.id}`, payload: { status: 'accepted' } },
    ] as const;
    for (const call of calls) {
      const res = await app.inject(call);
      expect(res.statusCode, `${call.method} ${call.url}`).toBe(404);
    }
    const [after] = await db.select().from(t.conventions).where(eq(t.conventions.id, row!.id));
    expect(after).toMatchObject({ status: 'pending', accepted: false });
    expect(await scanRows(repo!.id)).toEqual([]);
    await app.close();
  });

  it('runs on the model picked in Settings → Models for Conventions', async () => {
    const openai = new MockLLMProvider('openai', { structuredBySchema: { ConventionExtraction: { candidates: [IMPORT_RULE] } } });
    const { app: built, openrouter } = makeApp([THROW_RULE], { openai });
    const app = await built;
    const saved = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { feature_models: { conventions: { provider: 'openai', model: 'gpt-4.1-mini' } } },
    });
    expect(saved.statusCode).toBe(200);

    const res = await extract(app);
    expect(res.statusCode).toBe(202);
    expect(ConventionsState.parse(res.json()).latest_scan).toMatchObject({ provider: 'openai', model: 'gpt-4.1-mini' });
    await app.container.jobs.onIdle();
    expect((await state(app)).scan).toMatchObject({ status: 'done', provider: 'openai', model: 'gpt-4.1-mini' });
    expect(openai.calls.filter((c) => c.method === 'completeStructured').map((c) => (c.req as { model: string }).model)).toEqual([
      'gpt-4.1-mini',
    ]);
    expect(openrouter.calls).toEqual([]);

    // Settings live in this file's shared database: later tests scan on the default again.
    const restored = await app.inject({
      method: 'PUT',
      url: '/settings',
      payload: { feature_models: { conventions: { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' } } },
    });
    expect(restored.statusCode).toBe(200);
    await app.close();
  });

  it('a POST while a scan is active returns that scan and creates no second row', async () => {
    const held = await newRepo('held');
    const { app: built, openrouter } = makeApp([THROW_RULE]);
    const app = await built;

    openrouter.hold();
    const first = ConventionsState.parse((await extract(app, held)).json());
    const scanId = first.latest_scan!.id;
    const again = await extract(app, held);
    expect(again.statusCode).toBe(202);
    expect(ConventionsState.parse(again.json()).latest_scan!.id).toBe(scanId);
    const burst = await Promise.all([extract(app, held), extract(app, held), extract(app, held)]);
    expect(burst.map((r) => [r.statusCode, r.json().latest_scan.id])).toEqual([
      [202, scanId],
      [202, scanId],
      [202, scanId],
    ]);
    expect(await scanRows(held)).toHaveLength(1);

    openrouter.release();
    await app.container.jobs.onIdle();
    expect((await state(app, held)).latest_scan).toMatchObject({ id: scanId, status: 'done' });
    expect(openrouter.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);

    // Simultaneous POSTs with no active scan: the partial unique index lets one queue it.
    openrouter.hold();
    const racing = await Promise.all([extract(app, held), extract(app, held), extract(app, held)]);
    expect(racing.map((r) => r.statusCode)).toEqual([202, 202, 202]);
    expect(new Set(racing.map((r) => r.json().latest_scan.id)).size).toBe(1);
    expect((await scanRows(held)).filter((r) => r.status === 'queued' || r.status === 'running')).toHaveLength(1);
    openrouter.release();
    await app.container.jobs.onIdle();
    expect(await scanRows(held)).toHaveLength(2);
    await app.close();
  });

  it('a failed model call fails the scan with its billed usage, and the model is called once', async () => {
    const repo = await newRepo('failing');
    const failing = new FailingLlm('openrouter');
    const app = await makeApp([], { openrouter: failing }).app;

    const failed = await scanNow(app, repo);
    expect(failed.scan).toBeNull();
    expect(failed.latest_scan).toMatchObject({
      status: 'failed',
      error: 'The conventions model call failed: upstream 503',
      cost_usd: 0.0004,
    });
    const [row] = await scanRows(repo);
    expect(row).toMatchObject({ tokensIn: 900, tokensOut: 40 });
    // One paid call, and the jobs row is done: the failure lives on the scan row.
    expect(failing.calls).toHaveLength(1);
    const [job] = await pg.handle.db.select().from(t.jobs).where(eq(t.jobs.id, row!.jobId!));
    expect(job).toMatchObject({ status: 'done', attempts: 1 });
    await app.close();
  });

  it('the partial unique index allows one queued or running scan per repo', async () => {
    const repo = await newRepo('one-active');
    const { db } = pg.handle;
    const scan = (status: 'queued' | 'running' | 'done' | 'failed') =>
      db.insert(t.conventionScans).values({ workspaceId, repoId: repo, provider: 'openrouter', model: 'm', status });
    await scan('running');
    const second = await scan('queued').catch((err: unknown) => err);
    expect(isUniqueViolation(second, 'convention_scans_repo_active_uq')).toBe(true);
    await scan('done');
    await scan('failed');
    expect((await scanRows(repo)).map((r) => r.status).sort()).toEqual(['done', 'failed', 'running']);
  });

  it('a new app instance fails the scans a previous process left queued or running', async () => {
    const repo = await newRepo('restarted');
    const [running] = await pg.handle.db
      .insert(t.conventionScans)
      .values({ workspaceId, repoId: repo, provider: 'openrouter', model: 'm', status: 'running', startedAt: new Date() })
      .returning();

    const app = await makeApp([THROW_RULE]).app;
    const reaped = await state(app, repo);
    expect(reaped.scan).toBeNull();
    expect(reaped.latest_scan).toMatchObject({
      id: running!.id,
      status: 'failed',
      error: 'The API restarted while this scan was running',
    });
    expect(reaped.latest_scan!.finished_at).toEqual(expect.any(String));

    // The repo is free again.
    const next = await scanNow(app, repo);
    expect(next.latest_scan).toMatchObject({ status: 'done' });
    expect(next.latest_scan!.id).not.toBe(running!.id);
    await app.close();
  });
});
