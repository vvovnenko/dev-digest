import type { ModelInfo } from '@devdigest/shared';

type Estimator = (model: string, tokensIn: number, tokensOut: number) => number | null;

type LlmProviderId = ModelInfo['provider'];

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/**
 * The OpenRouter catalog ids a provider's model may be priced under, in lookup
 * order. An OpenRouter model is its own id. A direct provider's model is also
 * tried under the provider's namespace; Anthropic's ids additionally drop a dated
 * snapshot suffix and write the version with a dot, as the catalog does
 * (`claude-opus-5-5`, `claude-haiku-4-5-20251001` → `anthropic/claude-opus-5.5`,
 * `anthropic/claude-haiku-4.5`).
 */
export function catalogIds(provider: LlmProviderId, model: string): string[] {
  if (provider === 'openrouter') return [model];
  if (provider === 'openai') return [model, `openai/${model}`];
  const alias = model.replace(/-\d{8}$/, '').replace(/-(\d+)-(\d+)$/, '-$1.$2');
  return [model, `anthropic/${alias}`];
}

/**
 * Live OpenRouter pricing for cost attribution (Settings spec, Feature 2).
 *
 * OpenRouter's `/models` endpoint returns per-model prices (USD per 1M tokens),
 * so we cache them and use them for `estimateCost` instead of relying on a
 * hardcoded table for the models we actually run. The cache refreshes lazily
 * (non-blocking) on a TTL; until it is warm we fall back to the static table.
 *
 * The OpenAI and Anthropic APIs return tokens, never prices, but the catalog
 * also lists their models at list price under its own ids (`openai/gpt-5.5`,
 * `anthropic/claude-opus-5.5`), so `estimatorFor(provider)` looks a direct
 * provider's model up under that alias first (see `catalogIds`), then falls back
 * to the static table — null only when neither knows the model.
 *
 * `estimate` is SYNCHRONOUS by design: it is injected into the LLM adapters'
 * per-call cost hook, which cannot await. The first call after a
 * cold start (or expiry) returns the fallback while a refresh runs in the
 * background; subsequent calls use the live prices.
 */
export class PriceBook {
  private prices = new Map<string, { in: number; out: number }>();
  private expires = 0;
  private refreshing = false;

  constructor(
    private listOpenRouterModels: () => Promise<ModelInfo[]>,
    private fallback: Estimator,
    private ttlMs = SIX_HOURS_MS,
    private now: () => number = () => Date.now(),
  ) {}

  /** Synchronous cost in USD: live OpenRouter price if cached, else the fallback table. */
  estimate(model: string, tokensIn: number, tokensOut: number): number | null {
    return this.estimatorFor('openrouter')(model, tokensIn, tokensOut);
  }

  /**
   * The estimator to inject into `provider`'s adapter: the live catalog price of
   * the model (under its catalog alias for a direct provider), else the fallback.
   */
  estimatorFor(provider: LlmProviderId): Estimator {
    return (model, tokensIn, tokensOut) => {
      this.maybeRefresh();
      for (const id of catalogIds(provider, model)) {
        const p = this.prices.get(id);
        if (p) return (tokensIn * p.in + tokensOut * p.out) / 1_000_000;
      }
      return this.fallback(model, tokensIn, tokensOut);
    };
  }

  /** Force a synchronous-await refresh (e.g. to warm the cache). Never throws. */
  async refresh(): Promise<void> {
    try {
      this.ingest(await this.listOpenRouterModels());
      this.expires = this.now() + this.ttlMs;
    } catch {
      this.expires = 0;
    }
  }

  private ingest(models: ModelInfo[]): void {
    for (const m of models) {
      if (m.pricing) {
        this.prices.set(m.id, { in: m.pricing.promptPerM, out: m.pricing.completionPerM });
      }
    }
  }

  private maybeRefresh(): void {
    if (this.refreshing) return;
    if (this.now() < this.expires && this.prices.size > 0) return;
    this.refreshing = true;
    this.expires = this.now() + this.ttlMs; // set early so concurrent calls don't stampede
    this.listOpenRouterModels()
      .then((models) => this.ingest(models))
      .catch(() => {
        this.expires = 0; // allow a retry on the next call
      })
      .finally(() => {
        this.refreshing = false;
      });
  }
}
