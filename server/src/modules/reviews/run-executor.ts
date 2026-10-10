import type {
  LLMUsage,
  PromptSkillBlock,
  Provider,
  Review,
  ReviewIntentContext,
  RunTrace,
  UnifiedDiff,
} from '@devdigest/shared';
import { reviewPullRequest, countBlockers, skillBlocks, usageOf } from '@devdigest/reviewer-core';
import { RunLogger } from '../../platform/run-logger.js';
import type { FindingRecord, ReviewAgent, ReviewPull, ReviewRecord, ReviewRepoRef } from './domain.js';
import type { ReviewDeps } from './ports.js';
import { REVIEW_STRATEGY } from './constants.js';
import { splitInjectedSkills, taskLine } from './helpers.js';

/** Thrown by a run told to stop mid-flight: a user's cancel or an API shutdown. */
export class RunCancelledError extends Error {
  constructor() {
    super('Run cancelled');
    this.name = 'RunCancelledError';
  }
}

/** What a run stopped by an API shutdown records as its error. */
export const RUN_SHUTDOWN_ERROR = 'The API shut down while this run was in progress';

/** The skills block a run's prompt carried, kept for its trace (a failed run's too). */
type SkillTrace = { text: string; blocks: PromptSkillBlock[] };

/** Minimal structured logger (pino-compatible: (obj, msg)) for runtime logs. */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
};

/** What the shared pre-work hands every agent run of a request. */
type PrepWork = { intent: ReviewIntentContext | null; body: string | null };

// A reduced "Review per file" — same schema as Review (the model returns a small
// Review per file; we merge findings + take the worst verdict / mean score).
export type RunOutcome = {
  review: ReviewRecord;
  findings: FindingRecord[];
  grounding: string;
  raw: Review;
};

/**
 * Owns the background execution of queued agent runs (extracted from
 * ReviewService; behaviour unchanged). Loads the diff + intent once, then
 * map-reduces each agent, streaming events over the runBus and persisting each
 * review. Per-agent failures are isolated.
 */
export class ReviewRunExecutor {
  constructor(private deps: ReviewDeps) {}

  /**
   * Background execution of the queued agent runs (NOT awaited by the route).
   * Loads the diff + intent once, then map-reduces each agent, streaming events
   * over the runBus and persisting each review. Per-agent failures are isolated.
   */
  async executeRuns(
    workspaceId: string,
    pull: ReviewPull,
    repo: ReviewRepoRef,
    jobs: { agent: ReviewAgent; runId: string }[],
    logger?: Logger,
  ): Promise<void> {
    // Claim every queued run now, before the first await, so a shutdown waits
    // for the agents still waiting their turn too.
    this.deps.runs.claim(jobs.map((j) => j.runId));

    // ONE logger fanned out over every queued run: shared pre-work (diff +
    // intent) is streamed into each target agent's Live Log and persisted into
    // each run's trace. Per-agent work below narrows it to a single run.
    const runLog = new RunLogger(
      this.deps.runs,
      jobs.map((j) => j.runId),
      logger,
      { prId: pull.id },
    );

    // Pre-work failure (e.g. diff load) fails EVERY queued run. The error was
    // already emitted via runLog (fanned out → in each run's buffer); here we
    // mark the rows failed and persist the buffered log so it survives a reload.
    const failAll = async (msg: string) => {
      for (const { runId, agent } of jobs) {
        await this.deps.store
          .finishRunUnsuccessfully(
            runId,
            { status: 'failed', error: msg, durationMs: 0, tokensIn: 0, tokensOut: 0, costUsd: null },
            this.traceFromBuffer(runId, pull, agent, '0/0 passed'),
          )
          .catch((err) => logger?.error({ runId, err: (err as Error).message }, 'review: could not record the failed run'));
        this.deps.runs.complete(runId);
      }
    };

    let diff: UnifiedDiff;
    try {
      diff = await runLog.step('Loading PR diff', () => this.deps.diffs.forPull(pull, repo), {
        kind: 'tool',
      });
    } catch (err) {
      runLog.error(`Failed to load PR diff: ${(err as Error).message}`);
      await failAll(`Failed to load PR diff: ${(err as Error).message}`);
      return;
    }
    runLog.info(`Diff ready — ${diff.files.length} changed file(s); starting ${jobs.length} agent run(s)`);

    // The PR's intent for the prompt. Not fatal: a review does not depend on it, and the service
    // never throws — a PR that has none gets one derived here, the agents then share it.
    let prep: PrepWork = { intent: null, body: pull.body };
    if (this.deps.intentOnReview) {
      prep = await runLog
        .step('Preparing PR intent', () => this.deps.intent.forReview(workspaceId, pull, { diff, log: runLog }))
        .catch(() => prep);
    }

    for (const { agent, runId } of jobs) {
      const agentStart = Date.now();
      logger?.info(
        { runId, agent: agent.name, provider: agent.provider, model: agent.model, prId: pull.id },
        `review: agent "${agent.name}" started (${agent.provider}/${agent.model})`,
      );
      try {
        const outcome = await this.runOneAgent(workspaceId, pull, repo, diff, prep, agent, runId, runLog);
        logger?.info(
          {
            runId,
            agent: agent.name,
            findings: outcome.findings.length,
            grounding: outcome.grounding,
            durationMs: Date.now() - agentStart,
          },
          `review: agent "${agent.name}" done — ${outcome.findings.length} finding(s)`,
        );
      } catch (err) {
        // runOneAgent already persisted the failure/cancel (status + error +
        // trace) and completed the bus; here we only log at the run level.
        const cancelled = err instanceof RunCancelledError;
        logger?.[cancelled ? 'info' : 'error'](
          { runId, agent: agent.name, err: (err as Error).message, durationMs: Date.now() - agentStart },
          `review: agent "${agent.name}" ${cancelled ? 'cancelled' : 'failed'}`,
        );
      }
    }
  }

  /** Execute a single agent's review against a PR, streaming progress. */
  private async runOneAgent(
    workspaceId: string,
    pull: ReviewPull,
    repo: ReviewRepoRef,
    diff: UnifiedDiff,
    prep: PrepWork,
    agent: ReviewAgent,
    runId: string,
    parentLog: RunLogger,
  ): Promise<RunOutcome> {
    const start = Date.now();
    // Narrow the fanned-out pre-work logger to THIS run; the shared diff/intent
    // events are already in this run's buffer, so the persisted trace below
    // (built from the buffer) includes them too.
    const runLog = parentLog.forRun(runId, { agent: agent.name });
    // Start the run in this process: cancel() aborts the in-flight LLM call via this signal.
    const signal = this.deps.runs.track(runId);

    runLog.info(`Starting review with agent "${agent.name}" (${agent.provider}/${agent.model})`);
    // Set once the skills are loaded, so a run that fails later still traces them.
    let skillTrace: SkillTrace | undefined;

    try {
      // Cancelled while waiting its turn, or the API is shutting down.
      if (this.deps.runs.stopReason(runId)) throw new RunCancelledError();
      // Resolve the agent's LLM provider. (deps.llm throws if the provider
      // key is missing — caught below and persisted as a failed run.)
      const llm = await runLog.step(
        `Resolving ${agent.provider} provider`,
        () => this.deps.llm(agent.provider as Provider),
        { kind: 'tool' },
      );

      // L02 — the agent's enabled skills, in its order. A DB failure here fails
      // the run: reviewing without the agent's rules would look like a pass.
      const loaded = await runLog.step('Loading skills', () => this.deps.agents.enabledSkills(workspaceId, agent.id));
      const { kept: skills, blocked } = splitInjectedSkills(loaded); // a flagged skill never reaches the prompt
      if (blocked.length > 0) runLog.info(`skills: ${blocked.length} blocked (prompt injection detected)`, { skills: blocked.map((b) => b.name) });
      const blocks = skillBlocks(skills);
      const skillTokens = blocks.reduce((sum, b) => sum + b.tokens, 0);
      runLog.info(`skills: ${blocks.length} attached (+${skillTokens} tokens)`, {
        skills: blocks.map((b) => ({ name: b.name, version: b.version, tokens: b.tokens })),
      });
      if (blocks.length > 0) skillTrace = { text: blocks.map((b) => b.text).join('\n\n'), blocks };

      // Per-agent repo-intel toggle (Agent editor). When an agent opts out we
      // skip all enrichment entirely so its prompt is identical to the
      // repo-intel-off baseline — independent of the global REPO_INTEL_ENABLED
      // flag, which still gates the facade internally.
      const repoIntelOn = agent.repoIntel !== false;
      if (!repoIntelOn) runLog.info('Repo intel disabled for this agent — skipping context enrichment');

      // T1.3 — callers-in-prompt. Best-effort: when repo-intel is off the facade
      // returns []; we omit the section and behavior is identical to the
      // pre-T1.3 prompt (acceptance #10).
      const callersDigest = repoIntelOn
        ? await this.buildCallersDigest(pull.repoId, diff, runLog)
        : undefined;

      // T3 — repo skeleton + "changed files are top-5%" framing. Both best-
      // effort: when repo-intel is off / unindexed the facade degrades and the
      // prompt is identical to the pre-T3 shape.
      const repoMap = repoIntelOn ? await this.buildRepoMapDigest(pull.repoId, runLog) : undefined;
      const rankNote = repoIntelOn ? await this.buildRankNote(pull.repoId, diff, runLog) : '';

      const task = taskLine(pull) + rankNote;

      // ---- Engine: assemble → single-pass → grounding -----------------------
      // The pure review pipeline lives in @devdigest/reviewer-core (shared with
      // the CI runner). The service owns only I/O: repo-intel context resolution
      // above, and persistence + observability below.
      const outcome = await reviewPullRequest({
        systemPrompt: agent.systemPrompt,
        model: agent.model,
        diff,
        llm,
        // Per-agent review strategy (configured in the Agent editor); falls back
        // to the studio default. single-pass = whole diff in one call.
        strategy: agent.strategy ?? REVIEW_STRATEGY,
        // The verdict is derived from the grounded findings under this agent's gate.
        failOn: agent.ciFailOn,
        // T1.3 — pass the callers digest only when we built one. assemblePrompt
        // omits the section when this is empty/undefined.
        ...(callersDigest ? { callers: callersDigest } : {}),
        // T3 — repo skeleton, same omit-when-empty contract.
        ...(repoMap ? { repoMap } : {}),
        // L02 — the agent's skills (trusted instructions); omitted when none is enabled.
        ...(skills.length > 0 ? { skills } : {}),
        // PR author's description/body — untrusted; assemblePrompt wraps +
        // truncates it. Omitted when the PR has no body.
        ...(prep.body ? { prDescription: prep.body } : {}),
        // The derived intent; the engine flags and filters findings outside it. Omitted when there is none.
        ...(prep.intent ? { intent: prep.intent } : {}),
        // Title/author are author-controlled too: wrapped, never in `task`.
        pr: { title: pull.title, author: pull.author },
        task,
        sessionId: `${repo.owner}/${repo.name}#${pull.number}:${agent.name}`,
        onEvent: (e) => runLog.event(e.kind, e.msg, e.data),
        checkCancelled: () => {
          if (this.deps.runs.stopReason(runId)) throw new RunCancelledError();
        },
        signal,
      });
      // A cancel that arrived after the last LLM call still wins: don't save the review.
      if (this.deps.runs.stopReason(runId)) throw new RunCancelledError();
      const { tokensIn, tokensOut, costUsd, grounding } = outcome;

      const keptFindings = outcome.review.findings;
      const durationMs = Date.now() - start;

      // Deterministic blocker count (severity ≥ the agent's gate) — the signal
      // the timeline colors on, NOT the model's self-reported verdict.
      const blockers = countBlockers(keptFindings, agent.ciFailOn);

      runLog.info('Review ready; saving it with the run and its trace');
      const trace: RunTrace = {
        config: {
          agent: agent.name,
          version: String(agent.version),
          provider: agent.provider,
          model: agent.model,
          pr: pull.number,
          source: 'local',
        },
        stats: {
          duration_ms: durationMs,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          cost_usd: costUsd,
          findings: keptFindings.length,
          grounding,
        },
        prompt_assembly: outcome.assembly,
        tool_calls: outcome.chunks.map((c) => ({
          tool: 'review_file',
          args: c.label,
          meta: outcome.mode,
          ms: Math.round(durationMs / Math.max(outcome.chunks.length, 1)),
        })),
        raw_output: outcome.raw,
        memory_pulled: [],
        specs_read: [],
        // Persisted log = the run's FULL event buffer (incl. shared pre-work:
        // diff load + intent), not just events recorded inside this method.
        log: runLog.logFor(runId),
      };
      // ---- Persist: run row + review + findings + reviewed sha + trace, in ONE
      // transaction that only commits while the run is still `running`.
      const saved = await this.deps.store.completeRunWithReview(runId, {
        run: {
          durationMs,
          tokensIn,
          tokensOut,
          costUsd,
          findingsCount: keptFindings.length,
          grounding,
          score: outcome.review.score,
          blockers,
        },
        review: {
          workspaceId,
          prId: pull.id,
          agentId: agent.id,
          kind: 'review',
          verdict: outcome.review.verdict,
          summary: outcome.review.summary,
          score: outcome.review.score,
          model: agent.model,
        },
        findings: keptFindings,
        // The commit this review ran against, so the PR list can tell reviewed /
        // needs-review (head moved) / stale apart.
        reviewedSha: pull.headSha,
        trace,
      });
      // Cancelled (or deleted) while we were saving: nothing was written.
      if (!saved) throw new RunCancelledError();
      runLog.result(`Persisted review ${saved.review.id} with ${saved.findings.length} finding(s)`);
      this.deps.runs.complete(runId);

      return { review: saved.review, findings: saved.findings, grounding, raw: outcome.review };
    } catch (err) {
      // Failure/cancel: persist status + the error text + what the calls cost +
      // the log-so-far, so the run (and WHY it failed) is visible after a reload.
      // An aborted LLM call surfaces as a provider error — the stop reason says
      // why it was aborted. A shutdown is a failure the user didn't ask for.
      const reason =
        this.deps.runs.stopReason(runId) ?? (err instanceof RunCancelledError ? 'cancelled' : undefined);
      const status = reason === 'cancelled' ? 'cancelled' : 'failed';
      const msg =
        reason === 'cancelled' ? 'Cancelled by user' : reason === 'shutdown' ? RUN_SHUTDOWN_ERROR : (err as Error).message;
      const spent = usageOf(err);
      runLog.error(reason === 'cancelled' ? 'Run cancelled by user' : `Run failed: ${msg}`);
      await this.deps.store
        .finishRunUnsuccessfully(
          runId,
          {
            status,
            error: msg,
            durationMs: Date.now() - start,
            tokensIn: spent?.tokensIn ?? 0,
            tokensOut: spent?.tokensOut ?? 0,
            costUsd: spent?.costUsd ?? null,
          },
          this.traceFromBuffer(runId, pull, agent, '0/0 passed', Date.now() - start, spent, skillTrace),
        )
        .catch((writeErr) => runLog.error(`Could not record the ${status} run: ${(writeErr as Error).message}`));
      this.deps.runs.complete(runId);
      throw err;
    }
  }

  /**
   * Build a compact "Callers of changed symbols" digest for the prompt.
   *
   * Returns `undefined` when nothing should be added (flag off, no callers
   * found, or repo-intel errors) — `reviewPullRequest` omits the section in
   * that case (acceptance #10: flag off → identical prompt).
   *
   * Compact format: one bullet per caller, grouped by file. Trimmed (limit 10
   * rows per `getCallerSignatures` call) so the section stays under ~600
   * tokens even on heavy PRs.
   */
  private async buildCallersDigest(
    repoId: string,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<string | undefined> {
    const changedFiles = diff.files.map((f) => f.path);
    if (changedFiles.length === 0) return undefined;
    let rows;
    try {
      rows = await this.deps.repoContext.getCallerSignatures(repoId, changedFiles, 10);
    } catch (err) {
      // Never let an enrichment break the run — surface only as a Live Log info.
      runLog.info(`callers digest: repoIntel failed — ${(err as Error).message}`);
      return undefined;
    }
    if (rows.length === 0) return undefined;

    const byFile = new Map<string, string[]>();
    for (const r of rows) {
      const lines = byFile.get(r.file) ?? [];
      lines.push(`- \`${r.symbol}\` — ${r.signature}`);
      byFile.set(r.file, lines);
    }
    const out: string[] = [];
    for (const [file, lines] of byFile) {
      out.push(`### ${file}`);
      out.push(...lines);
    }
    runLog.info(`callers digest: ${rows.length} caller signature(s) attached`);
    return out.join('\n');
  }

  /**
   * T3 — fetch the cached repo skeleton for the prompt's `## Repo skeleton`
   * slot. Returns `undefined` when repo-intel is off / the repo isn't indexed
   * (the facade degrades), so the prompt stays identical to the pre-T3 shape.
   */
  private async buildRepoMapDigest(
    repoId: string,
    runLog: RunLogger,
  ): Promise<string | undefined> {
    try {
      const map = await this.deps.repoContext.getRepoMap(repoId);
      if (map.degraded || map.text.trim().length === 0) return undefined;
      runLog.info(`repo map: ${map.tokens} token(s) attached (cached=${map.cached})`);
      return map.text;
    } catch (err) {
      runLog.info(`repo map: repoIntel failed — ${(err as Error).message}`);
      return undefined;
    }
  }

  /**
   * T3 — a one-line "N of M changed files are in the top 5% most-depended-on"
   * note appended to the task framing, so the model prioritises hot core files.
   * Empty string when repo-intel is off / no changed file is hot.
   */
  private async buildRankNote(
    repoId: string,
    diff: UnifiedDiff,
    runLog: RunLogger,
  ): Promise<string> {
    const changedFiles = diff.files.map((f) => f.path);
    if (changedFiles.length === 0) return '';
    try {
      const ranks = await this.deps.repoContext.getFileRank(repoId, changedFiles);
      if (ranks.length === 0) return '';
      const hot = ranks.filter((r) => r.percentile >= 95);
      if (hot.length === 0) return '';
      runLog.info(`file rank: ${hot.length}/${changedFiles.length} changed file(s) in top 5%`);
      return `\n\n${hot.length} of ${changedFiles.length} changed file(s) are in the top 5% most-depended-on (high blast risk) — prioritise their correctness.`;
    } catch (err) {
      runLog.info(`file rank: repoIntel failed — ${(err as Error).message}`);
      return '';
    }
  }

  /**
   * A minimal RunTrace whose `log` is the run's full SSE buffer — persisted on
   * failure/cancel (and pre-work failures) so the events (and WHY it failed)
   * survive a reload, not just the in-memory stream.
   */
  private traceFromBuffer(
    runId: string,
    pull: ReviewPull,
    agent: ReviewAgent,
    grounding: string,
    durationMs = 0,
    spent?: LLMUsage | null,
    skills?: SkillTrace,
  ): RunTrace {
    return {
      config: {
        agent: agent.name,
        version: String(agent.version),
        provider: agent.provider,
        model: agent.model,
        pr: pull.number,
        source: 'local',
      },
      stats: {
        duration_ms: durationMs,
        tokens_in: spent?.tokensIn ?? 0,
        tokens_out: spent?.tokensOut ?? 0,
        cost_usd: spent?.costUsd ?? null,
        findings: 0,
        grounding,
      },
      prompt_assembly: {
        system: agent.systemPrompt,
        skills: skills?.text ?? null,
        skill_blocks: skills?.blocks ?? null,
        memory: null,
        specs: null,
        user: '',
      },
      tool_calls: [],
      raw_output: '',
      memory_pulled: [],
      specs_read: [],
      log: this.deps.runs.buffer(runId).map((e) => ({ t: e.t, kind: e.kind, msg: e.msg })),
    };
  }
}
