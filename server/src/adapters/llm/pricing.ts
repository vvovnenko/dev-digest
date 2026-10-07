/**
 * cost discipline — per-provider/model pricing table (USD per 1M tokens).
 * Unknown models return null cost (explicitly flagged), per spec.
 */
interface Price {
  in: number;
  out: number;
}

const PRICING: Record<string, Price> = {
  // OpenAI (approximate public list prices, USD / 1M tokens)
  'gpt-5.5': { in: 5.0, out: 30.0 },
  'gpt-5.4': { in: 2.5, out: 15.0 },
  'gpt-5.4-mini': { in: 0.75, out: 4.5 },
  'gpt-5.4-nano': { in: 0.2, out: 1.25 },
  'gpt-5.1': { in: 1.25, out: 10.0 },
  'gpt-5': { in: 1.25, out: 10.0 },
  'gpt-4.1': { in: 2.0, out: 8.0 },
  'gpt-4.1-mini': { in: 0.4, out: 1.6 },
  'gpt-4o': { in: 2.5, out: 10.0 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'text-embedding-3-small': { in: 0.02, out: 0 },
  // Anthropic (list prices; the Messages API returns tokens only, never USD)
  'claude-fable-5-1': { in: 10.0, out: 50.0 },
  'claude-fable-5': { in: 10.0, out: 50.0 },
  'claude-opus-5-5': { in: 4.0, out: 20.0 },
  'claude-opus-5': { in: 5.0, out: 25.0 },
  'claude-opus-4-8': { in: 5.0, out: 25.0 },
  'claude-opus-4-7': { in: 5.0, out: 25.0 },
  'claude-opus-4-6': { in: 5.0, out: 25.0 },
  'claude-sonnet-5-5': { in: 2.0, out: 10.0 },
  'claude-sonnet-5': { in: 2.0, out: 10.0 },
  'claude-sonnet-4-6': { in: 3.0, out: 15.0 },
  'claude-haiku-4-5': { in: 1.0, out: 5.0 },
  'claude-3-5-sonnet-latest': { in: 3.0, out: 15.0 },
  'claude-3-5-haiku-latest': { in: 0.8, out: 4.0 },
  'claude-3-opus-latest': { in: 15.0, out: 75.0 },
  // OpenRouter (CI runner, cheap models). Slugs + prices are APPROXIMATE and
  // must be confirmed against openrouter.ai/models before relying on cost.
  // Unknown slugs fall through to null cost (explicitly flagged), which is safe.
  'z-ai/glm-4.7-flash': { in: 0, out: 0 }, // free baseline for evals
  'deepseek/deepseek-v4-flash': { in: 0.14, out: 0.28 },
  'z-ai/glm-4.7-flashx': { in: 0.15, out: 0.4 },
  'minimax/minimax-m2.5': { in: 0.3, out: 1.2 },
  'z-ai/glm-5.1': { in: 0.6, out: 2.2 },
};

/** USD for a call, or null when the model's price is unknown. Injected into the LLM adapters. */
export type CostEstimator = (model: string, tokensIn: number, tokensOut: number) => number | null;

/** A dated snapshot id (`claude-haiku-4-5-20251001`) is priced as its alias. */
const DATE_SUFFIX = /-\d{8}$/;

export function estimateCost(model: string, tokensIn: number, tokensOut: number): number | null {
  const p = PRICING[model] ?? PRICING[model.replace(DATE_SUFFIX, '')];
  if (!p) return null;
  return (tokensIn * p.in + tokensOut * p.out) / 1_000_000;
}
