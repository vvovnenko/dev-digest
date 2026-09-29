/**
 * OpenRouterProvider against a fake fetch: what a failed structured call
 * reports as billed, and which failures are not retried.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { LlmCallError } from '../src/index.js';
import { OpenRouterProvider } from '../src/llm/openrouter.js';

const Schema = z.object({ ok: z.boolean() });

function completion(content: string, finishReason = 'stop') {
  return {
    id: 'gen-1',
    object: 'chat.completion',
    created: 0,
    model: 'm',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost: 0.001 },
  };
}

/** Answers every request with the next body and records what was sent. */
function fakeFetch(bodies: object[]) {
  const sent: Record<string, unknown>[] = [];
  const fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    sent.push(JSON.parse(String(init?.body)));
    const body = bodies[Math.min(sent.length - 1, bodies.length - 1)];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, sent };
}

const request = (extra: Partial<Parameters<OpenRouterProvider['completeStructured']>[0]> = {}) => ({
  model: 'm',
  schema: Schema,
  schemaName: 'Probe',
  messages: [{ role: 'user' as const, content: 'hi' }],
  ...extra,
});

describe('OpenRouterProvider.completeStructured', () => {
  it('returns the parsed data with the billed cost', async () => {
    const { fetch } = fakeFetch([completion('{"ok":true}')]);
    const res = await new OpenRouterProvider('k', { fetch, maxRetries: 0 }).completeStructured(request());
    expect(res.data).toEqual({ ok: true });
    expect(res.costUsd).toBe(0.001);
  });

  it('does not retry an answer cut off at the token limit, and reports what it cost', async () => {
    const { fetch, sent } = fakeFetch([completion('{"ok":', 'length')]);
    const err = await new OpenRouterProvider('k', { fetch, maxRetries: 0 })
      .completeStructured(request({ maxTokens: 64, maxRetries: 2 }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmCallError);
    expect((err as LlmCallError).message).toMatch(/cut off at the token limit \(64\)/);
    expect((err as LlmCallError).usage).toEqual({ tokensIn: 100, tokensOut: 50, costUsd: 0.001 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.max_tokens).toBe(64);
  });

  it('sums every attempt when the schema never validates', async () => {
    const { fetch, sent } = fakeFetch([completion('not json')]);
    const err = (await new OpenRouterProvider('k', { fetch, maxRetries: 0 })
      .completeStructured(request({ maxRetries: 1 }))
      .catch((e: unknown) => e)) as LlmCallError;
    expect(sent).toHaveLength(2);
    expect(err).toBeInstanceOf(LlmCallError);
    expect([err.usage.tokensIn, err.usage.tokensOut]).toEqual([200, 100]);
    expect(err.usage.costUsd).toBeCloseTo(0.002, 10);
  });

  it('does not call the API once the signal is aborted', async () => {
    const { fetch, sent } = fakeFetch([completion('{"ok":true}')]);
    const controller = new AbortController();
    controller.abort();
    const err = await new OpenRouterProvider('k', { fetch, maxRetries: 0 })
      .completeStructured(request({ signal: controller.signal }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmCallError);
    expect(sent).toHaveLength(0);
  });
});

describe('OpenRouterProvider.listModels', () => {
  it('uses the injected fetch, and gives up on a hanging /models after the timeout', async () => {
    const fetch = ((_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
      })) as unknown as typeof globalThis.fetch;
    const provider = new OpenRouterProvider('k', { fetch, timeoutMs: 20 });
    await expect(provider.listModels()).rejects.toThrow(/timeout|aborted/i);
  });
});
