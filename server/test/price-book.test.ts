import { describe, it, expect } from 'vitest';
import type { ModelInfo } from '@devdigest/shared';
import { PriceBook, catalogIds } from '../src/platform/price-book.js';

const MODELS: ModelInfo[] = [
  {
    id: 'deepseek/deepseek-v4-flash',
    provider: 'openrouter',
    pricing: { promptPerM: 0.14, completionPerM: 0.28 },
    contextLength: 1_000_000,
  },
];

describe('PriceBook (live OpenRouter pricing for cost attribution)', () => {
  it('uses the fallback until the cache is warm, then live OpenRouter prices', async () => {
    const t = 0;
    // Fallback only knows the static deepseek price; live price will differ.
    const fallback = (m: string) => (m === 'deepseek/deepseek-v4-flash' ? 0.999 : null);
    const pb = new PriceBook(async () => MODELS, fallback, 1000, () => t);

    // Cold cache → fallback value.
    expect(pb.estimate('deepseek/deepseek-v4-flash', 1_000_000, 1_000_000)).toBe(0.999);

    await pb.refresh();
    // Warm: 1e6 * 0.14 (in) + 1e6 * 0.28 (out) = 0.42.
    expect(pb.estimate('deepseek/deepseek-v4-flash', 1_000_000, 1_000_000)).toBeCloseTo(0.42, 9);
  });

  it('falls back for models the OpenRouter list does not price, and returns null when neither knows it', async () => {
    const pb = new PriceBook(async () => MODELS, (m) => (m === 'gpt-4.1' ? 12.34 : null));
    await pb.refresh();
    expect(pb.estimate('gpt-4.1', 0, 0)).toBe(12.34); // not an OR model → static fallback
    expect(pb.estimate('mystery/model', 0, 0)).toBe(null); // unknown everywhere
  });

  it('never throws when the model list fetch fails (stays on the fallback)', async () => {
    const pb = new PriceBook(
      async () => {
        throw new Error('network down');
      },
      (m) => (m === 'deepseek/deepseek-v4-flash' ? 0.5 : null),
    );
    await pb.refresh(); // swallows the error
    expect(pb.estimate('deepseek/deepseek-v4-flash', 0, 0)).toBe(0.5);
  });
});

describe('PriceBook.estimatorFor (direct providers priced under their catalog alias)', () => {
  const LIVE: ModelInfo[] = [
    ...MODELS,
    { id: 'anthropic/claude-opus-5.5', provider: 'openrouter', pricing: { promptPerM: 4, completionPerM: 20 } },
    { id: 'anthropic/claude-haiku-4.5', provider: 'openrouter', pricing: { promptPerM: 1, completionPerM: 5 } },
    { id: 'openai/gpt-5.5', provider: 'openrouter', pricing: { promptPerM: 5, completionPerM: 30 } },
  ];
  const warm = async (fallback: (m: string) => number | null = () => null) => {
    const pb = new PriceBook(async () => LIVE, fallback);
    await pb.refresh();
    return pb;
  };

  it('maps Anthropic ids to the catalog: dotted version, dated snapshot dropped', () => {
    expect(catalogIds('anthropic', 'claude-opus-5-5')).toEqual(['claude-opus-5-5', 'anthropic/claude-opus-5.5']);
    expect(catalogIds('anthropic', 'claude-haiku-4-5-20251001')).toEqual([
      'claude-haiku-4-5-20251001',
      'anthropic/claude-haiku-4.5',
    ]);
    expect(catalogIds('anthropic', 'claude-opus-5')).toEqual(['claude-opus-5', 'anthropic/claude-opus-5']);
    expect(catalogIds('openai', 'gpt-5.5')).toEqual(['gpt-5.5', 'openai/gpt-5.5']);
    expect(catalogIds('openrouter', 'claude-opus-5-5')).toEqual(['claude-opus-5-5']);
  });

  it('prices an Anthropic or OpenAI model from its live catalog entry', async () => {
    const pb = await warm();
    expect(pb.estimatorFor('anthropic')('claude-opus-5-5', 1_000_000, 1_000_000)).toBeCloseTo(24, 9);
    expect(pb.estimatorFor('anthropic')('claude-haiku-4-5-20251001', 1_000_000, 1_000_000)).toBeCloseTo(6, 9);
    expect(pb.estimatorFor('openai')('gpt-5.5', 1_000_000, 1_000_000)).toBeCloseTo(35, 9);
  });

  it('falls back to the static table for a model the catalog lacks, with its own id', async () => {
    const asked: string[] = [];
    const pb = await warm((m) => (asked.push(m), m === 'claude-sonnet-4-6' ? 0.5 : null));
    expect(pb.estimatorFor('anthropic')('claude-sonnet-4-6', 1, 1)).toBe(0.5);
    expect(pb.estimatorFor('anthropic')('claude-unknown-9', 1, 1)).toBeNull();
    expect(asked).toEqual(['claude-sonnet-4-6', 'claude-unknown-9']);
  });

  it('never aliases an OpenRouter model id', async () => {
    const pb = await warm(() => null);
    expect(pb.estimatorFor('openrouter')('claude-opus-5-5', 1, 1)).toBeNull();
    expect(pb.estimate('claude-opus-5-5', 1, 1)).toBeNull();
  });
});
