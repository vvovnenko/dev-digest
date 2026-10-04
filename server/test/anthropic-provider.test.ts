import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { AnthropicProvider } from '../src/adapters/llm/anthropic.js';

/**
 * AnthropicProvider.completeStructured against a fake Messages API (an injected
 * fetch — no network). The newest models reject a forced tool_choice with a 400;
 * the provider falls back to `tool_choice: auto` and remembers the model.
 */

const Out = z.object({ verdict: z.string(), score: z.number().int().min(0).max(100) });

const FORCED_REJECTED = {
  type: 'error',
  error: {
    type: 'invalid_request_error',
    message: 'tool_choice: type "tool" and "any" are not supported for this model.',
  },
  request_id: 'req_test',
};

const TEMPERATURE_REJECTED = {
  type: 'error',
  error: { type: 'invalid_request_error', message: '`temperature` is deprecated for this model.' },
  request_id: 'req_test',
};

type Body = {
  model: string;
  system?: string;
  temperature?: number;
  tool_choice: { type: string };
  messages: { role: string; content: unknown }[];
};

function message(content: unknown[]) {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'm',
    content,
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

const toolUse = (id: string, input: unknown) => ({ type: 'tool_use', id, name: 'Review', input });

/** A fake fetch that records every request body and answers from `reply`. */
function fakeApi(reply: (body: Body, n: number) => { status: number; json: unknown }) {
  const bodies: Body[] = [];
  const fetch = async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body)) as Body;
    bodies.push(body);
    const { status, json } = reply(body, bodies.length);
    return new Response(JSON.stringify(json), {
      status,
      headers: { 'content-type': 'application/json', 'request-id': 'req_test' },
    });
  };
  return { bodies, fetch: fetch as unknown as typeof globalThis.fetch };
}

/** A model that 400s on any forced tool_choice, like Opus 5.5. */
const rejectsForced = (answer: (n: number) => unknown[]) => (body: Body, n: number) =>
  body.tool_choice.type === 'tool'
    ? { status: 400, json: FORCED_REJECTED }
    : { status: 200, json: message(answer(n)) };

const request = (model: string) => ({
  model,
  schema: Out,
  schemaName: 'Review',
  messages: [
    { role: 'system' as const, content: 'SYS' },
    { role: 'user' as const, content: 'review this' },
  ],
});

/** A model that 400s on a forced tool_choice, then on any `temperature` — like Opus 5.5. */
const rejectsForcedAndTemperature = (answer: unknown[]) => (body: Body) =>
  body.tool_choice?.type === 'tool'
    ? { status: 400, json: FORCED_REJECTED }
    : 'temperature' in body
      ? { status: 400, json: TEMPERATURE_REJECTED }
      : { status: 200, json: message(answer) };

describe('AnthropicProvider.completeStructured', () => {
  it('forces the tool on a model that accepts it', async () => {
    const api = fakeApi(() => ({ status: 200, json: message([toolUse('t1', { verdict: 'approve', score: 90 })]) }));
    const res = await new AnthropicProvider('k', { fetch: api.fetch }).completeStructured(request('claude-old'));

    expect(res.data).toEqual({ verdict: 'approve', score: 90 });
    expect(api.bodies).toHaveLength(1);
    expect(api.bodies[0]!.tool_choice).toEqual({ type: 'tool', name: 'Review' });
    expect(api.bodies[0]!.system).toBe('SYS');
  });

  it('falls back to tool_choice auto when the model rejects forced tool use, once per model', async () => {
    const api = fakeApi(rejectsForced(() => [toolUse('t1', { verdict: 'comment', score: 70 })]));
    const provider = new AnthropicProvider('k', { fetch: api.fetch });

    const first = await provider.completeStructured(request('claude-opus-5-5'));
    expect(first.data).toEqual({ verdict: 'comment', score: 70 });
    expect(api.bodies.map((b) => b.tool_choice.type)).toEqual(['tool', 'auto']);
    // Without forcing, the system prompt tells the model to call the tool.
    expect(api.bodies[1]!.system).toMatch(/^SYS\n\nRespond only by calling the `Review` tool/);

    await provider.completeStructured(request('claude-opus-5-5'));
    expect(api.bodies.map((b) => b.tool_choice.type)).toEqual(['tool', 'auto', 'auto']);
  });

  it('parses a text answer when the model replies without calling the tool', async () => {
    const api = fakeApi(
      rejectsForced(() => [{ type: 'text', text: 'Here it is:\n```json\n{"verdict":"approve","score":100}\n```' }]),
    );
    const res = await new AnthropicProvider('k', { fetch: api.fetch }).completeStructured(request('claude-opus-5-5'));
    expect(res.data).toEqual({ verdict: 'approve', score: 100 });
    expect(res.attempts).toBe(1);
  });

  it('answers an invalid tool call with a tool_result before reprompting', async () => {
    const api = fakeApi(rejectsForced((n) =>
      n === 2 ? [toolUse('toolu_bad', { verdict: 'approve', score: 500 })] : [toolUse('toolu_ok', { verdict: 'approve', score: 50 })],
    ));
    const res = await new AnthropicProvider('k', { fetch: api.fetch }).completeStructured(request('claude-opus-5-5'));

    expect(res.data).toEqual({ verdict: 'approve', score: 50 });
    expect(res.attempts).toBe(2);
    const retry = api.bodies[2]!.messages;
    expect(retry.at(-2)).toMatchObject({ role: 'assistant' });
    expect(retry.at(-1)).toMatchObject({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_bad', is_error: true }],
    });
  });

  it('rethrows any other 400 without falling back', async () => {
    const api = fakeApi(() => ({
      status: 400,
      json: { type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens: must be at least 1' } },
    }));
    await expect(
      new AnthropicProvider('k', { fetch: api.fetch }).completeStructured(request('claude-old')),
    ).rejects.toThrow(/max_tokens/);
    expect(api.bodies).toHaveLength(1);
  });
  it('drops a rejected tool_choice and then a rejected temperature, remembering both', async () => {
    const api = fakeApi(rejectsForcedAndTemperature([toolUse('t1', { verdict: 'approve', score: 80 })]));
    const provider = new AnthropicProvider('k', { fetch: api.fetch });
    const sent = () => api.bodies.map((b) => [b.tool_choice.type, 'temperature' in b]);

    const first = await provider.completeStructured(request('claude-opus-5-5'));
    expect(first.data).toEqual({ verdict: 'approve', score: 80 });
    expect(sent()).toEqual([
      ['tool', true],
      ['auto', true],
      ['auto', false],
    ]);

    await provider.completeStructured(request('claude-opus-5-5'));
    expect(sent().slice(3)).toEqual([['auto', false]]);
  });

  it('keeps forcing the tool on a model that rejects only temperature', async () => {
    const api = fakeApi((body) =>
      'temperature' in body
        ? { status: 400, json: TEMPERATURE_REJECTED }
        : { status: 200, json: message([toolUse('t1', { verdict: 'approve', score: 60 })]) },
    );
    const res = await new AnthropicProvider('k', { fetch: api.fetch }).completeStructured(request('claude-x'));
    expect(res.data.score).toBe(60);
    expect(api.bodies.map((b) => [b.tool_choice.type, 'temperature' in b])).toEqual([
      ['tool', true],
      ['tool', false],
    ]);
  });
});

describe('AnthropicProvider.complete', () => {
  it('drops a rejected temperature and remembers it for the model', async () => {
    const api = fakeApi((body) =>
      'temperature' in body
        ? { status: 400, json: TEMPERATURE_REJECTED }
        : { status: 200, json: message([{ type: 'text', text: 'hello' }]) },
    );
    const provider = new AnthropicProvider('k', { fetch: api.fetch });
    const req = { model: 'claude-opus-5-5', messages: [{ role: 'user' as const, content: 'hi' }] };

    expect((await provider.complete(req)).text).toBe('hello');
    await provider.complete(req);
    expect(api.bodies.map((b) => 'temperature' in b)).toEqual([true, false, false]);
  });
});

describe('AnthropicProvider cost (the Messages API returns tokens only)', () => {
  const valid = [toolUse('t1', { verdict: 'approve', score: 50 })];
  const invalid = [toolUse('t1', { verdict: 'approve', score: 500 })];

  it('prices a current model from the static table when no estimator is injected', async () => {
    const api = fakeApi(rejectsForced(() => valid));
    const res = await new AnthropicProvider('k', { fetch: api.fetch }).completeStructured(request('claude-opus-5-5'));
    // The rejected forced call is not billed: one answer of 10 in / 5 out at $4 / $20 per 1M.
    expect(res.costUsd).toBeCloseTo((10 * 4 + 5 * 20) / 1_000_000, 12);
  });

  it('prices the tokens summed over every attempt with the injected estimator', async () => {
    const calls: [string, number, number][] = [];
    const estimateCost = (model: string, tokensIn: number, tokensOut: number) => {
      calls.push([model, tokensIn, tokensOut]);
      return 0.42;
    };
    const api = fakeApi(rejectsForced((n) => (n === 2 ? invalid : valid)));
    const res = await new AnthropicProvider('k', { fetch: api.fetch, estimateCost }).completeStructured(
      request('claude-opus-5-5'),
    );

    expect(res.attempts).toBe(2);
    expect(res.costUsd).toBe(0.42);
    expect(calls).toEqual([['claude-opus-5-5', 20, 10]]);
  });

  it('carries the estimated cost on a schema failure and prices complete() too', async () => {
    const estimateCost = (_m: string, tokensIn: number, tokensOut: number) => tokensIn + tokensOut;
    const failing = new AnthropicProvider('k', {
      fetch: fakeApi(() => ({ status: 200, json: message(invalid) })).fetch,
      estimateCost,
    });
    await expect(failing.completeStructured(request('claude-x'))).rejects.toMatchObject({
      usage: { tokensIn: 30, tokensOut: 15, costUsd: 45 },
    });

    const texting = new AnthropicProvider('k', {
      fetch: fakeApi(() => ({ status: 200, json: message([{ type: 'text', text: 'hi' }]) })).fetch,
      estimateCost,
    });
    const res = await texting.complete({ model: 'claude-x', messages: [{ role: 'user', content: 'hi' }] });
    expect(res.costUsd).toBe(15);
  });
});
