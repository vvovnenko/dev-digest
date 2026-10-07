import type { LLMUsage } from '@devdigest/shared';

/**
 * Errors the engine throws when a review call fails. They carry what was
 * already billed, so a failed run can still record its real cost instead of 0.
 */

/** An LLM call (or a whole review) that failed after spending `usage`. */
export class LlmCallError extends Error {
  readonly usage: LLMUsage;

  constructor(message: string, usage: LLMUsage, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LlmCallError';
    this.usage = usage;
  }
}

/** The diff is too large to review at all; no LLM call was made. */
export class DiffTooLargeError extends Error {
  constructor(chars: number, limit: number) {
    super(`Diff is ${chars} characters, over the ${limit}-character review limit — nothing was sent to the model`);
    this.name = 'DiffTooLargeError';
  }
}

/** Nothing in the diff could be sent to the model; a review of nothing must not "approve". */
export class NothingToReviewError extends Error {
  constructor() {
    super('The diff has no reviewable text — nothing was sent to the model');
    this.name = 'NothingToReviewError';
  }
}

export const NO_USAGE: LLMUsage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };

/** A failed call that reported nothing: it may have been billed, so its cost is unknown. */
export const UNKNOWN_USAGE: LLMUsage = { tokensIn: 0, tokensOut: 0, costUsd: null };

/** Billed usage an error carries (`usage` on any provider's error), if any. */
export function usageOf(err: unknown): LLMUsage | null {
  const u = (err as { usage?: Partial<LLMUsage> } | null | undefined)?.usage;
  if (!u || typeof u.tokensIn !== 'number' || typeof u.tokensOut !== 'number') return null;
  return { tokensIn: u.tokensIn, tokensOut: u.tokensOut, costUsd: typeof u.costUsd === 'number' ? u.costUsd : null };
}

/** Sum two usages; an unknown cost on either side makes the total unknown. */
export function addUsage(a: LLMUsage, b: LLMUsage): LLMUsage {
  return {
    tokensIn: a.tokensIn + b.tokensIn,
    tokensOut: a.tokensOut + b.tokensOut,
    costUsd: a.costUsd == null || b.costUsd == null ? null : a.costUsd + b.costUsd,
  };
}
