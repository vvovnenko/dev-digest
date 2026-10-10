/**
 * @devdigest/reviewer-core — the review engine.
 *
 * Pure review logic shared by the server (local reviews in the studio) and the
 * agent-runner (CI). NO database, GitHub, or filesystem access; the only side
 * effect is an LLM call through an INJECTED LLMProvider (so it is mock-testable).
 *
 * Consumers wire it via a tsconfig path alias (`@devdigest/reviewer-core` →
 * `../reviewer-core/src`) and consume the TypeScript source directly (tsx in
 * dev, vitest in tests, @vercel/ncc bundle in the runner). The package itself
 * never emits JS — its `build` is a type-check.
 */

// Prompt assembly + prompt-injection hardening.
export {
  assemblePrompt,
  wrapUntrusted,
  estimateTokens,
  renderSkill,
  renderIntentSection,
  skillBlocks,
  type PromptParts,
  type PromptSkill,
  type AssembledPrompt,
} from './prompt.js';

// Citation grounding — the mandatory mechanical gate for diff findings.
export {
  groundFindings,
  groundingSummary,
  type GroundingResult,
  type GroundingOptions,
} from './grounding.js';

// Intent scope — the deterministic out-of-scope filter applied after grounding.
export { applyIntentScope, type ScopeMode, type ScopeResult } from './scope.js';

// Structured-output helpers (Zod → JSON Schema + parse-with-repair).
export {
  toJsonSchema,
  extractJson,
  parseWithRepair,
  type JsonSchema,
  type ParseResult,
} from './llm/structured.js';

// Map-reduce helpers (reduce partials, slice a file's diff).
export { reduceReviews, sliceDiff } from './review/reduce.js';

// The engine entry point: given (diff + resolved agent inputs + LLM) → grounded Review.
export {
  reviewPullRequest,
  DEFAULT_MAP_THRESHOLD_LINES,
  DEFAULT_REVIEW_MAX_RETRIES,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_MAX_DIFF_CHARS,
  DEFAULT_SINGLE_PASS_MAX_CHARS,
  type ReviewInput,
  type ReviewOutcome,
  type ReviewEvent,
  type ReviewStrategy,
  type ReviewMode,
} from './review/run.js';

// Output: grounded Review → GitHubReviewPayload (body + inline comments + event).
export {
  toReviewPayload,
  gateTriggered,
  countBlockers,
  verdictFromFindings,
  type ToReviewOptions,
} from './output/to-review.js';

// Failures that carry what was already billed, so a failed run records its cost.
export { LlmCallError, DiffTooLargeError, NothingToReviewError, usageOf } from './llm/errors.js';

// The network-bound provider is NOT exported here, so importing the engine never
// pulls in an HTTP client: take it from `@devdigest/reviewer-core/llm/openrouter`
// (server: platform/container.ts only; enforced by `pnpm arch`).
