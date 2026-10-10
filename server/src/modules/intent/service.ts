import { createHash } from 'node:crypto';
import {
  Provider,
  type IntentSource,
  type PrIntentState,
  type RepoRef,
  type ReviewIntentContext,
  type StructuredResult,
  type UnifiedDiff,
} from '@devdigest/shared';
import { usageOf } from '@devdigest/reviewer-core';
import { AppError, ExternalServiceError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { withTimeout } from '../../platform/resilience.js';
import {
  ACTIVE_INTENT_STATUSES,
  IntentClassification,
  IntentJob,
  addedFileText,
  extractReferences,
  fileOutline,
  finalizeIntent,
  intentFreshness,
  normalizeIntentInput,
  type IntentPull,
  type IntentRecord,
  type IntentRepoRef,
  type IntentResult,
  type IntentReviewPull,
  type Reference,
  type ReferenceTarget,
} from './domain.js';
import { fetchReason, githubReason, messageOf, toStateDto } from './helpers.js';
import { buildIntentPrompt, type PromptDocument } from './prompt.js';
import type { IntentDeps } from './ports.js';
import {
  CLASSIFY_TIMEOUT_MS,
  INTENT_JOB_KIND,
  INTENT_MAX_RETRIES,
  INTENT_MAX_TOKENS,
  INTENT_SCHEMA_NAME,
  INTERRUPTED_INTENT_ERROR,
  MAX_LINKED_CHARS,
  MAX_SOURCE_CHARS,
  MAX_URL_BYTES,
  REFRESH_TIMEOUT_MS,
  SOURCE_TIMEOUT_MS,
} from './constants.js';

/**
 * Intent Layer — a cheap model derives what a PR is about from its title, branch,
 * description, the outline of its changed files and the documents it links; code caps
 * the confidence and keeps the unreadable links as `missing_context`. A derive runs as a
 * background job (or inline, as pre-work of a review); its `pr_intent` row carries the
 * status the UI polls. One active attempt per PR, held by the store's conditional upsert.
 */

type Trigger = 'manual' | 'review';

/** What a derive collects for its one log line, whether or not it finishes. */
interface Trace {
  parts: { name: string; tokens: number }[];
  sources: IntentSource[];
  files: number;
  hunks: number;
  confidence: string | null;
  capped: boolean;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  /** The PR's description after the derive's refresh. */
  body: string | null;
}

interface DeriveOptions {
  trigger: Trigger;
  /** `always` for a manual derive; `if_missing` for pre-work, which reads GitHub only when the PR has no description. */
  refresh: 'always' | 'if_missing';
  /** The review run's diff; read through the diff source when absent. */
  diff?: UnifiedDiff | undefined;
}

/** A document read, or why it could not be. */
type Read = { text: string } | { reason: string };

export class IntentService {
  constructor(private deps: IntentDeps) {}

  async state(workspaceId: string, prId: string): Promise<PrIntentState> {
    return this.stateOf(workspaceId, (await this.loadPull(workspaceId, prId)).pull);
  }

  /**
   * Derive intent / Re-derive: queue an attempt and the job that runs it, unless the PR
   * already has an active one — then nothing changes. The guards answer at once; the
   * model call happens in `runJob`.
   */
  async requestDerive(workspaceId: string, prId: string): Promise<PrIntentState> {
    const { pull } = await this.loadPull(workspaceId, prId);
    const choice = await this.deps.model(workspaceId);
    const row = await this.deps.store.claim({ workspaceId, prId, provider: choice.provider, model: choice.model });
    // An attempt is already active (a concurrent request won): show it as it is.
    if (!row) return this.stateOf(workspaceId, pull);

    let job: { id: string };
    try {
      job = await this.deps.jobs.enqueue(workspaceId, INTENT_JOB_KIND, { workspaceId, prId });
    } catch (err) {
      // E.g. 503 shutting_down: no job will ever run this attempt.
      await this.deps.store.fail(workspaceId, prId, { error: messageOf(err) });
      throw err;
    }
    await this.deps.store.setJobId(workspaceId, prId, job.id);
    return this.stateOf(workspaceId, pull);
  }

  /** Register the `pr-intent` job handler once (at plugin registration). */
  registerJobHandler(): void {
    this.deps.jobs.register(INTENT_JOB_KIND, (payload) => this.runJob(payload));
  }

  /**
   * The job: refresh → sources → prompt → model → store, recorded on the PR's row. An
   * attempt that is gone or no longer active (reaped by a restart) is left alone.
   *
   * It never throws once the attempt is running: every failure — a missing key
   * (ConfigError, 500), a model error (502), a deleted PR — is written to the row as
   * `failed`, with what the call billed. The JobRunner retries a thrown 5xx twice
   * (`platform/resilience.ts`), which would pay for the model call three times. Only a
   * malformed payload throws, as a 422 that is not retried: there is no row to record it on.
   */
  async runJob(payload: unknown): Promise<void> {
    const parsed = IntentJob.safeParse(payload);
    if (!parsed.success) {
      throw new ValidationError('Malformed pr-intent job payload', parsed.error.flatten());
    }
    const { workspaceId, prId } = parsed.data;
    const row = await this.deps.store.markRunning(workspaceId, prId);
    if (!row) return;
    await this.execute(workspaceId, row, { trigger: 'manual', refresh: 'always' });
  }

  /** On boot: fail the attempts a previous process left active — their jobs lived in its memory. */
  reapInterrupted(): Promise<number> {
    return this.deps.store.reapActive(INTERRUPTED_INTENT_ERROR);
  }

  /**
   * Pre-work of a review run: the PR's intent for the prompt. A stored result is used as
   * it is (`stale` when the PR moved on); with none and no attempt in flight it is derived
   * here, inline, and stored; with an attempt in flight the review goes without. It never
   * throws — a review does not depend on its intent. `body` is the description to review
   * with: the PR's own, or the one just read from GitHub for a PR that had none.
   */
  async forReview(
    workspaceId: string,
    pull: IntentReviewPull,
    ctx: { diff: UnifiedDiff; log: { info(msg: string, data?: unknown): void } },
  ): Promise<{ intent: ReviewIntentContext | null; body: string | null }> {
    const without = { intent: null, body: pull.body };
    try {
      const row = await this.deps.store.get(workspaceId, pull.id);
      if (row && hasResult(row)) {
        const fresh = intentFreshness(
          { headSha: row.headSha, inputHash: row.inputHash },
          { headSha: pull.headSha, inputHash: inputHashOf(pull) },
        );
        ctx.log.info(reviewLogLine(row, fresh, 'stored'));
        return { intent: toContext(row, fresh.stale), body: pull.body };
      }
      if (row && isActive(row)) {
        ctx.log.info('intent: an attempt is in flight; reviewing without it');
        return without;
      }

      const choice = await this.deps.model(workspaceId);
      const claimed = await this.deps.store.claim({
        workspaceId,
        prId: pull.id,
        provider: choice.provider,
        model: choice.model,
      });
      const running = claimed && (await this.deps.store.markRunning(workspaceId, pull.id));
      if (!running) return without;

      const out = await this.execute(workspaceId, running, { trigger: 'review', refresh: 'if_missing', diff: ctx.diff });
      const body = out.body ?? pull.body;
      if (!out.record || !hasResult(out.record)) {
        ctx.log.info('intent: could not be derived; reviewing without it');
        return { intent: null, body };
      }
      ctx.log.info(reviewLogLine(out.record, { stale: false, reason: null }, 'derived inline'));
      return { intent: toContext(out.record, false), body };
    } catch (err) {
      this.deps.log.warn({ prId: pull.id, error: errorCode(err) }, 'intent: pre-work failed (review continues)');
      return without;
    }
  }

  /** One attempt: derive, store the result or the failure, log one line. Never throws on a derive failure. */
  private async execute(
    workspaceId: string,
    row: IntentRecord,
    opts: DeriveOptions,
  ): Promise<{ record: IntentRecord | undefined; body: string | null }> {
    const started = Date.now();
    const trace: Trace = {
      parts: [],
      sources: [],
      files: 0,
      hunks: 0,
      confidence: null,
      capped: false,
      tokensIn: null,
      tokensOut: null,
      costUsd: null,
      body: null,
    };
    const logLine = (outcome: string, extra: object = {}) => {
      const line = {
        prId: row.prId,
        trigger: opts.trigger,
        provider: row.provider,
        model: row.model,
        prompt_parts: trace.parts,
        tokens_est: trace.parts.reduce((n, p) => n + p.tokens, 0),
        sources: trace.sources.map((s) => ({ kind: s.kind, ref: s.ref, status: s.status, reason: s.reason, chars: s.chars })),
        files: trace.files,
        hunks: trace.hunks,
        tokens_in: trace.tokensIn,
        tokens_out: trace.tokensOut,
        cost_usd: trace.costUsd,
        duration_ms: Date.now() - started,
        confidence: trace.confidence,
        capped: trace.capped,
        outcome,
        ...extra,
      };
      if (outcome === 'failed') this.deps.log.warn(line, 'intent: classified');
      else this.deps.log.info(line, 'intent: classified');
    };

    try {
      const result = await this.derive(workspaceId, row, opts, trace);
      const record = await this.deps.store.complete(workspaceId, row.prId, result);
      logLine(record ? 'done' : 'discarded');
      return { record, body: trace.body };
    } catch (err) {
      logLine('failed', { error: errorCode(err) });
      try {
        await this.deps.store.fail(workspaceId, row.prId, { error: messageOf(err), usage: usageOf(err) ?? null });
      } catch (failErr) {
        this.deps.log.warn({ prId: row.prId, error: errorCode(failErr) }, 'intent: could not record the failure');
      }
      return { record: undefined, body: trace.body };
    }
  }

  /** Refresh → sources → prompt → model → the final intent. Throws whatever stops it. */
  private async derive(workspaceId: string, row: IntentRecord, opts: DeriveOptions, trace: Trace): Promise<IntentResult> {
    let found = await this.loadPull(workspaceId, row.prId);
    if (opts.refresh === 'always' || found.pull.body === null) {
      found = (await this.refreshDetail(workspaceId, found)) ?? found;
    }
    const { pull, repo } = found;
    trace.body = pull.body;

    const diff = opts.diff ?? (await this.deps.diffs.forPull(pull, repo));
    const repoRef: RepoRef = { owner: repo.owner, name: repo.name };
    const input = normalizeIntentInput(pull);
    const outline = fileOutline(diff.raw);
    trace.files = outline.files;
    trace.hunks = outline.hunks;

    const references = extractReferences({ title: pull.title, body: pull.body, branch: pull.branch, repo: repoRef });
    const linked = await this.readLinked(references, { diff, pull, repoRef });
    const sources: IntentSource[] = [
      { kind: 'title', ref: 'title', status: 'used', reason: null, chars: input.title.length },
      input.body
        ? { kind: 'description', ref: 'description', status: 'used', reason: null, chars: input.body.length }
        : { kind: 'description', ref: 'description', status: 'skipped', reason: 'empty', chars: 0 },
      outline.files > 0
        ? { kind: 'files', ref: 'files', status: outline.truncated ? 'truncated' : 'used', reason: null, chars: outline.text.length }
        : { kind: 'files', ref: 'files', status: 'skipped', reason: 'empty', chars: 0 },
      ...linked.map((l) => l.source),
    ];
    trace.sources = sources;

    const documents: PromptDocument[] = linked.flatMap((l) =>
      l.text === null ? [] : [{ kind: l.source.kind, ref: l.source.ref, text: l.text }],
    );
    const { messages, parts } = buildIntentPrompt({
      title: input.title,
      branch: pull.branch,
      description: input.body,
      outline: outline.text,
      documents,
      unavailable: sources.filter((s) => s.status === 'unavailable').map((s) => `${s.ref}: ${s.reason ?? 'error'}`),
    });
    trace.parts = parts;

    const choice = { provider: Provider.parse(row.provider), model: row.model ?? '' };
    let res: StructuredResult<IntentClassification>;
    try {
      const llm = await this.deps.llm(choice.provider);
      res = await llm.completeStructured({
        model: choice.model,
        schema: IntentClassification,
        schemaName: INTENT_SCHEMA_NAME,
        messages,
        maxTokens: INTENT_MAX_TOKENS,
        maxRetries: INTENT_MAX_RETRIES,
        signal: AbortSignal.timeout(CLASSIFY_TIMEOUT_MS),
      });
    } catch (err) {
      const usage = usageOf(err);
      if (usage) Object.assign(trace, { tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, costUsd: usage.costUsd });
      // A missing key (ConfigError) or an adapter's own error already has its message (and its `usage`).
      if (err instanceof AppError) throw err;
      const timedOut = (err as { name?: string } | null)?.name === 'TimeoutError';
      // Keeps what the failed call billed (`LlmCallError.usage`) for the row.
      throw Object.assign(
        new ExternalServiceError(
          timedOut
            ? `The intent model did not answer within ${CLASSIFY_TIMEOUT_MS / 1000} s`
            : `The intent model call failed: ${messageOf(err)}`,
          { provider: choice.provider, model: choice.model },
        ),
        { usage },
      );
    }
    trace.tokensIn = res.tokensIn;
    trace.tokensOut = res.tokensOut;
    trace.costUsd = res.costUsd;

    const final = finalizeIntent({ classification: res.data, sources });
    trace.confidence = final.confidence;
    trace.capped = final.confidence !== res.data.confidence;
    return {
      intent: final.summary,
      inScope: final.in_scope,
      outOfScope: final.out_of_scope,
      confidence: final.confidence,
      sources,
      missingContext: final.missing_context,
      headSha: pull.headSha,
      inputHash: inputHashOf(pull),
      tokensIn: res.tokensIn,
      tokensOut: res.tokensOut,
      costUsd: res.costUsd,
    };
  }

  /**
   * Re-reads the PR from GitHub and stores its description and stats; the stored PR is
   * returned again. Best effort: without a token, or when GitHub fails or is slow, the
   * derive goes on with what is stored (undefined).
   */
  private async refreshDetail(
    workspaceId: string,
    found: { pull: IntentPull; repo: IntentRepoRef },
  ): Promise<{ pull: IntentPull; repo: IntentRepoRef } | undefined> {
    try {
      const github = await this.deps.github();
      const detail = await withTimeout(
        github.getPullRequest({ owner: found.repo.owner, name: found.repo.name }, found.pull.number),
        REFRESH_TIMEOUT_MS,
      );
      await this.deps.pulls.replaceDetail(found.pull.id, detail);
      return (await this.deps.pulls.pullInWorkspace(workspaceId, found.pull.id)) ?? undefined;
    } catch (err) {
      this.deps.log.warn({ prId: found.pull.id, error: errorCode(err) }, 'intent: description refresh failed (using the stored one)');
      return undefined;
    }
  }

  /** Reads every pending reference at once, then spends the character budgets in order. */
  private async readLinked(
    references: readonly Reference[],
    ctx: { diff: UnifiedDiff; pull: IntentPull; repoRef: RepoRef },
  ): Promise<{ source: IntentSource; text: string | null }[]> {
    const reads = await Promise.all(
      references.map((r) => (r.status === 'pending' && r.target ? this.read(r.target, ctx) : null)),
    );
    let budget = MAX_LINKED_CHARS;
    return references.map((r, i) => {
      const read = reads[i];
      const base = { kind: r.kind, ref: r.ref };
      if (!read) {
        return { source: { ...base, status: r.status === 'pending' ? 'skipped' : r.status, reason: r.reason, chars: 0 }, text: null };
      }
      if ('reason' in read) {
        return { source: { ...base, status: 'unavailable', reason: read.reason, chars: 0 }, text: null };
      }
      if (budget <= 0) return { source: { ...base, status: 'skipped', reason: 'limit', chars: 0 }, text: null };
      const text = read.text.slice(0, Math.min(MAX_SOURCE_CHARS, budget));
      budget -= text.length;
      return {
        source: { ...base, status: text.length < read.text.length ? 'truncated' : 'used', reason: null, chars: text.length },
        text,
      };
    });
  }

  /** One linked document. A failure is a reason code, never the error's own text. */
  private async read(
    target: ReferenceTarget,
    ctx: { diff: UnifiedDiff; pull: IntentPull; repoRef: RepoRef },
  ): Promise<Read> {
    try {
      return await withTimeout(this.fetchTarget(target, ctx), SOURCE_TIMEOUT_MS);
    } catch (err) {
      return { reason: target.type === 'url' ? fetchReason(err) : githubReason(err) };
    }
  }

  private async fetchTarget(
    target: ReferenceTarget,
    ctx: { diff: UnifiedDiff; pull: IntentPull; repoRef: RepoRef },
  ): Promise<Read> {
    let text: string | null;
    if (target.type === 'issue') {
      const github = await this.deps.github();
      const issue = await github.getIssue({ owner: target.owner, name: target.repo }, target.number);
      text = `${issue.title}\n\n${issue.body ?? ''}`;
    } else if (target.type === 'repo_file') {
      // A file the PR adds whole is in the diff already.
      text = addedFileText(ctx.diff, target.path);
      if (text === null) {
        const github = await this.deps.github();
        text = await github.getFileText(ctx.repoRef, target.path, ctx.pull.headSha);
      }
    } else {
      const file = await this.deps.fetcher.fetch(new URL(target.url), { maxBytes: MAX_URL_BYTES });
      const type = file.contentType?.split(';')[0]?.trim().toLowerCase();
      if (type && !type.startsWith('text/') && !type.includes('markdown')) return { reason: 'unsupported_type' };
      text = new TextDecoder().decode(file.bytes);
    }
    return text !== null && text.trim() !== '' ? { text } : { reason: 'not_found' };
  }

  private async stateOf(workspaceId: string, pull: IntentPull): Promise<PrIntentState> {
    const row = await this.deps.store.get(workspaceId, pull.id);
    const fresh =
      row && hasResult(row)
        ? intentFreshness({ headSha: row.headSha, inputHash: row.inputHash }, { headSha: pull.headSha, inputHash: inputHashOf(pull) })
        : { stale: false, reason: null };
    return toStateDto(pull.id, row, { stale: fresh.stale, stale_reason: fresh.reason });
  }

  private async loadPull(workspaceId: string, prId: string): Promise<{ pull: IntentPull; repo: IntentRepoRef }> {
    const found = await this.deps.pulls.pullInWorkspace(workspaceId, prId);
    if (!found) throw new NotFoundError('Pull request not found');
    return found;
  }
}

const isActive = (row: IntentRecord) => (ACTIVE_INTENT_STATUSES as readonly string[]).includes(row.status);

/** A derive has succeeded on this row at least once. */
const hasResult = (row: IntentRecord): row is IntentRecord & { intent: string; confidence: NonNullable<IntentRecord['confidence']> } =>
  row.intent !== null && row.confidence !== null;

function toContext(
  row: IntentRecord & { intent: string; confidence: NonNullable<IntentRecord['confidence']> },
  stale: boolean,
): ReviewIntentContext {
  return { summary: row.intent, in_scope: row.inScope, out_of_scope: row.outOfScope, confidence: row.confidence, stale };
}

/**
 * The review run's log line for the intent it reviews with — mode, confidence, freshness and
 * source counts only, never the intent's text. The mode mirrors the engine's rule
 * (`applyIntentScope`: stale or low → tag-only).
 */
function reviewLogLine(
  row: IntentRecord & { confidence: NonNullable<IntentRecord['confidence']> },
  fresh: { stale: boolean; reason: string | null },
  origin: 'stored' | 'derived inline',
): string {
  const mode = fresh.stale || row.confidence === 'low' ? 'tag-only' : 'filter';
  const used = row.sources.filter((s) => s.status === 'used' || s.status === 'truncated').length;
  const unavailable = row.sources.filter((s) => s.status === 'unavailable').length;
  const stale = fresh.stale ? (fresh.reason ?? 'yes') : 'no';
  return `intent: ${mode} (confidence=${row.confidence}, stale=${stale}, sources ${used} used / ${unavailable} unavailable; ${origin})`;
}

/** sha256 of the normalized title and description: what "the description changed" is judged by. */
function inputHashOf(pull: { title: string; body: string | null }): string {
  const { title, body } = normalizeIntentInput(pull);
  return createHash('sha256').update(JSON.stringify([title, body])).digest('hex');
}

/** What is safe to log about a failure: a code or the error's class, never its text. */
function errorCode(err: unknown): string {
  return err instanceof AppError ? err.code : err instanceof Error ? err.name : 'unknown';
}
