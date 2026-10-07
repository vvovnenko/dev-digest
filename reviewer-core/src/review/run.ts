import type {
  CiFailOn,
  Finding,
  LLMProvider,
  LLMUsage,
  PromptAssembly,
  Review,
  RunEventKind,
  UnifiedDiff,
} from '@devdigest/shared';
import { Review as ReviewSchema } from '@devdigest/shared';
import { assemblePrompt, type PromptSkill } from '../prompt.js';
import { groundFindings, groundingSummary } from '../grounding.js';
import {
  DiffTooLargeError,
  LlmCallError,
  NO_USAGE,
  NothingToReviewError,
  UNKNOWN_USAGE,
  addUsage,
  usageOf,
} from '../llm/errors.js';
import { verdictFromFindings } from '../output/to-review.js';
import { reduceReviews, scoreFromFindings, sliceDiff } from './reduce.js';

/**
 * reviewPullRequest — the review engine entry point.
 *
 * given (diff + resolved agent inputs + injected LLM) → grounded Review.
 *
 * This is the pure core lifted out of the server's `ReviewService.runOneAgent`:
 * assemble prompt → single-pass OR map-reduce per file → reduce → SHARED
 * citation-grounding gate. It performs NO I/O beyond the injected LLM provider
 * (no DB, GitHub, fs, memory retrieval, intent, or persistence) — those stay in
 * the caller (server persists + streams SSE; runner posts + writes an artifact).
 *
 * Skills / memory / specs are RESOLVED here: the caller turns AgentManifest
 * skill slugs into PromptSkill objects (DB in the studio, fs in the runner).
 */

/** Default map-reduce threshold (matches the server's FILE_MAP_THRESHOLD_LINES). */
export const DEFAULT_MAP_THRESHOLD_LINES = 400;
/** Default structured-output reprompt retries (matches REVIEW_MAX_RETRIES). */
export const DEFAULT_REVIEW_MAX_RETRIES = 2;
/** Output cap per call: a review is a JSON list of findings; this bounds a runaway answer's cost. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
/** Above this the diff is refused before any call — it can't be reviewed within a model's context. */
export const DEFAULT_MAX_DIFF_CHARS = 2_000_000;
/** A single pass over more than this goes per file instead (when there is more than one file). */
export const DEFAULT_SINGLE_PASS_MAX_CHARS = 400_000;

export type ReviewStrategy = 'auto' | 'single-pass' | 'map-reduce';
export type ReviewMode = 'single-pass' | 'map-reduce';

/** Progress event emitted during a review (server → SSE bus, runner → log). */
export interface ReviewEvent {
  kind: RunEventKind;
  msg: string;
  data?: unknown;
}

export interface ReviewInput {
  /** Agent system prompt (trusted). */
  systemPrompt: string;
  /** Model id understood by the injected provider (e.g. 'deepseek/deepseek-v4-flash'). */
  model: string;
  /** The PR's unified diff (already parsed; hunks carry new-side line numbers). */
  diff: UnifiedDiff;
  /** Injected LLM provider (OpenRouter in CI, OpenAI/Anthropic in the studio). */
  llm: LLMProvider;
  /** 'auto' (default) picks single-pass unless the diff is large + multi-file. */
  strategy?: ReviewStrategy;
  /** Enabled skills in prompt order, resolved by the caller (NOT slugs). */
  skills?: PromptSkill[] | undefined;
  /** Curated memory items. */
  memory?: string[];
  /** Project-context spec chunks (untrusted; delimiter-wrapped downstream). */
  specs?: string[];
  /**
   * Optional callers-of-changed-symbols digest (T1.3). Untrusted; rendered
   * before the diff section. Empty/undefined → section omitted.
   */
  callers?: string;
  /**
   * Optional repo skeleton / map (T3). Untrusted; rendered before the project
   * context section. Empty/undefined → section omitted.
   */
  repoMap?: string;
  /** PR author's description/body (untrusted; truncated + delimiter-wrapped in
      the prompt). Empty/undefined → section omitted. */
  prDescription?: string;
  /** PR title + author (untrusted; rendered in their own wrapped block, never in `task`). */
  pr?: { title: string; author: string };
  /** Task framing line, e.g. "Review PR #482". Trusted: no PR text in it. */
  task?: string;
  /** Override the structured-output retry budget. */
  maxRetries?: number;
  /** Override the map-reduce line threshold. */
  mapThresholdLines?: number;
  /** Agent gate that turns the grounded findings into the verdict (default 'critical'). */
  failOn?: CiFailOn;
  /** Output-token cap per LLM call (default DEFAULT_MAX_OUTPUT_TOKENS). */
  maxTokens?: number;
  /** Refuse a larger diff before any call (default DEFAULT_MAX_DIFF_CHARS). */
  maxDiffChars?: number;
  /** Review per file instead of in one pass above this size (default DEFAULT_SINGLE_PASS_MAX_CHARS). */
  singlePassMaxChars?: number;
  /** Aborts the in-flight LLM call (e.g. the run was cancelled). */
  signal?: AbortSignal;
  /**
   * OpenRouter session id — forwarded on every LLM call so all chunks of this
   * review group into one session in the OpenRouter dashboard.
   */
  sessionId?: string;
  /** Progress sink. */
  onEvent?: (e: ReviewEvent) => void;
  /**
   * Cancellation checkpoint, called before each (expensive) chunk LLM call.
   * Supply a function that THROWS to abort mid-run (the caller owns the error
   * type, e.g. the server's RunCancelledError); the engine stays agnostic.
   */
  checkCancelled?: () => void;
}

export interface ReviewOutcome {
  /** The reduced, GROUNDED review (findings that survived the citation gate). */
  review: Review;
  /** Human-readable grounding summary, e.g. "3/4 passed". */
  grounding: string;
  /** Findings dropped by grounding, with reasons (for logs / "never go silent"). */
  dropped: { finding: Finding; reason: string }[];
  /** Which path ran. */
  mode: ReviewMode;
  /** Prompt assembly (for the run trace). Single-pass: the one call; map-reduce: the whole-diff assembly. */
  assembly: PromptAssembly;
  /** Per-chunk labels (for the run trace's tool_calls). */
  chunks: { label: string }[];
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  /** Joined raw model outputs (for the run trace). */
  raw: string;
}

function selectMode(
  strategy: ReviewStrategy,
  diff: UnifiedDiff,
  threshold: number,
  singlePassMaxChars: number,
): ReviewMode {
  const multiFile = diff.files.length > 1;
  // Whatever the strategy, a single pass must fit the model's context.
  if (multiFile && diff.raw.length > singlePassMaxChars) return 'map-reduce';
  if (strategy === 'single-pass') return 'single-pass';
  if (strategy === 'map-reduce') return multiFile ? 'map-reduce' : 'single-pass';
  // auto: map-reduce only when the diff is both large AND multi-file (else 1 call).
  const totalLines = diff.files.reduce((n, f) => n + f.additions + f.deletions, 0);
  return totalLines > threshold && multiFile ? 'map-reduce' : 'single-pass';
}

export async function reviewPullRequest(input: ReviewInput): Promise<ReviewOutcome> {
  const threshold = input.mapThresholdLines ?? DEFAULT_MAP_THRESHOLD_LINES;
  const maxRetries = input.maxRetries ?? DEFAULT_REVIEW_MAX_RETRIES;
  const maxDiffChars = input.maxDiffChars ?? DEFAULT_MAX_DIFF_CHARS;
  if (input.diff.raw.length > maxDiffChars) throw new DiffTooLargeError(input.diff.raw.length, maxDiffChars);
  const mode = selectMode(
    input.strategy ?? 'auto',
    input.diff,
    threshold,
    input.singlePassMaxChars ?? DEFAULT_SINGLE_PASS_MAX_CHARS,
  );
  const emit = (kind: RunEventKind, msg: string, data?: unknown) =>
    input.onEvent?.({ kind, msg, data });

  const promptParts = {
    system: input.systemPrompt,
    skills: input.skills,
    memory: input.memory,
    specs: input.specs,
    callers: input.callers,
    repoMap: input.repoMap,
    prDescription: input.prDescription,
    pr: input.pr,
    task: input.task,
  };

  // Whole-diff assembly is the trace default; overwritten below for single-pass.
  let assembly: PromptAssembly = assemblePrompt({ ...promptParts, diff: input.diff.raw }).assembly;

  const chunks =
    mode === 'map-reduce'
      ? input.diff.files.map((f) => ({ label: f.path, diffText: sliceDiff(input.diff, f.path) }))
      : [{ label: 'all files', diffText: input.diff.raw }];

  emit(
    'info',
    mode === 'map-reduce'
      ? `Large diff → map-reduce over ${input.diff.files.length} files`
      : `Reviewing ${input.diff.files.length} changed file(s) in one pass`,
  );

  const partials: Review[] = [];
  let spent: LLMUsage = NO_USAGE;
  const raws: string[] = [];

  for (const chunk of chunks) {
    // Cancellation checkpoint — stop before the next (expensive) LLM call.
    input.checkCancelled?.();
    if (!chunk.diffText.trim()) {
      emit('info', `${chunk.label}: no diff text for this file — skipped`);
      continue;
    }
    // 'map:' prefix only for the map-reduce path (one call per file). In
    // single-pass there is exactly one chunk (the whole diff) — don't mislabel it.
    emit(
      'tool',
      mode === 'map-reduce' ? `map: reviewing ${chunk.label}` : `Reviewing ${chunk.label} in one pass`,
      { file: chunk.label },
    );
    const a = assemblePrompt({ ...promptParts, diff: chunk.diffText });
    if (mode === 'single-pass') assembly = a.assembly;
    let res;
    try {
      res = await input.llm.completeStructured<Review>({
        model: input.model,
        schema: ReviewSchema,
        schemaName: 'Review',
        messages: a.messages,
        maxRetries,
        maxTokens: input.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      });
    } catch (err) {
      // Earlier chunks and this call's attempts were billed: carry the total. A
      // provider that reported nothing makes the cost unknown, not zero.
      const total = addUsage(spent, usageOf(err) ?? UNKNOWN_USAGE);
      throw new LlmCallError(`${chunk.label}: ${(err as Error).message}`, total, { cause: err });
    }
    spent = addUsage(spent, { tokensIn: res.tokensIn, tokensOut: res.tokensOut, costUsd: res.costUsd });
    raws.push(res.raw);
    partials.push(res.data);
    emit('result', `${chunk.label}: ${res.data.findings.length} candidate finding(s)`);
  }

  if (partials.length === 0) throw new NothingToReviewError();
  const merged = reduceReviews(partials);
  emit(
    'result',
    `Reduced to ${merged.findings.length} finding(s); verdict=${merged.verdict}, score=${merged.score}`,
  );

  // SHARED citation-grounding gate (the only post-step; not duplicated per strategy).
  const ground = groundFindings(merged.findings, input.diff);
  const grounding = groundingSummary(ground);
  for (const d of ground.dropped) {
    emit('info', `grounding dropped "${d.finding.title}": ${d.reason}`);
  }
  emit('result', `Citation grounding: ${grounding}`);

  // Score AND verdict are derived from the findings that SURVIVED grounding (not
  // the model's self-reported values, and not the pre-grounding set) so the score,
  // the verdict, the findings list and the GitHub event always agree.
  const verdict = verdictFromFindings(ground.kept, input.failOn ?? 'critical');
  if (verdict !== merged.verdict) {
    emit('info', `verdict ${merged.verdict} → ${verdict} (derived from the grounded findings)`);
  }
  return {
    review: { ...merged, verdict, findings: ground.kept, score: scoreFromFindings(ground.kept) },
    grounding,
    dropped: ground.dropped,
    mode,
    assembly,
    chunks: chunks.map((c) => ({ label: c.label })),
    tokensIn: spent.tokensIn,
    tokensOut: spent.tokensOut,
    costUsd: spent.costUsd,
    raw: raws.join('\n---\n'),
  };
}
