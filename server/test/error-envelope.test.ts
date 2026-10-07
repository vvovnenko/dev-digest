import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { ConfigError } from '../src/platform/errors.js';
import { MockAuthProvider } from '../src/adapters/mocks.js';

/**
 * The error envelope: every failure is `{ error: { code, message } }` with an
 * honest status, and a server fault never shows its raw message (SQL,
 * constraint names, paths) to the client. No DB needed.
 */
const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp({ config, overrides: { auth: new MockAuthProvider() } });
  app.get('/boom/db', async () => {
    throw Object.assign(new Error('duplicate key value violates unique constraint "repos_ws_fullname_lower_uq"'), {
      code: '23505',
    });
  });
  app.get('/boom/zod', async () => z.object({ a: z.string() }).parse({}));
  app.get('/boom/config', async () => {
    throw new ConfigError('OPENAI_API_KEY is not configured');
  });
  // What @fastify/rate-limit throws (its errorResponseBuilder result).
  app.get('/boom/rate', async () => {
    throw { statusCode: 429, message: 'Too many requests — retry in 1 minute' };
  });
  app.post('/echo', { bodyLimit: 16 }, async (req) => req.body);
  // A reply that breaks its declared response schema (contract drift).
  app
    .withTypeProvider<ZodTypeProvider>()
    .get('/boom/response', { schema: { response: { 200: z.object({ a: z.string() }) } } }, async () => ({ a: 1 }) as unknown as { a: string });
});
afterAll(async () => {
  await app.close();
});

const error = async (opts: InjectOptions) => {
  const res = await app.inject(opts);
  return { status: res.statusCode, ...(res.json() as { error: { code: string; message: string } }).error };
};

describe('error envelope', () => {
  it('hides a server fault behind a generic 500, including our own data failing a parse', async () => {
    const db = await error({ method: 'GET', url: '/boom/db' });
    expect(db).toMatchObject({ status: 500, code: 'internal_error', message: 'Internal error' });
    expect(JSON.stringify(db)).not.toMatch(/constraint|23505/);
    expect(await error({ method: 'GET', url: '/boom/zod' })).toMatchObject({ status: 500, code: 'internal_error' });
    const drift = await error({ method: 'GET', url: '/boom/response' });
    expect(drift).toMatchObject({ status: 500, code: 'internal_error', message: 'Internal error' });
  });

  it('keeps an AppError as written, 5xx included', async () => {
    expect(await error({ method: 'GET', url: '/boom/config' })).toMatchObject({
      status: 500,
      code: 'config_error',
      message: 'OPENAI_API_KEY is not configured',
    });
  });

  it("gives Fastify's own client errors their status and a stable code", async () => {
    expect(await error({ method: 'GET', url: '/boom/rate' })).toMatchObject({ status: 429, code: 'rate_limited' });
    const big = { method: 'POST' as const, url: '/echo', payload: { text: 'more than sixteen bytes' } };
    expect(await error(big)).toMatchObject({ status: 413, code: 'payload_too_large' });
    expect(
      await error({ method: 'POST', url: '/echo', payload: '<x/>', headers: { 'content-type': 'text/xml' } }),
    ).toMatchObject({ status: 415, code: 'unsupported_media_type' });
    expect(
      await error({ method: 'POST', url: '/echo', payload: '{"a":', headers: { 'content-type': 'application/json' } }),
    ).toMatchObject({ status: 400, code: 'bad_request' });
  });

  it('answers an unknown route with the envelope', async () => {
    expect(await error({ method: 'GET', url: '/nope' })).toMatchObject({ status: 404, code: 'not_found' });
  });

  it('validates the review request: a non-uuid agent id, or no target at all, is a 422', async () => {
    const prId = '00000000-0000-4000-8000-000000000000';
    const bad = await error({ method: 'POST', url: `/pulls/${prId}/review`, payload: { agentId: 'general' } });
    expect(bad).toMatchObject({ status: 422, code: 'validation_error' });
    const neither = await error({ method: 'POST', url: `/pulls/${prId}/review`, payload: {} });
    expect(neither).toMatchObject({ status: 422, code: 'validation_error', message: 'Provide agentId or all:true' });
  });
});
