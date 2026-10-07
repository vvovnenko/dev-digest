import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockGitHubClient, MockLLMProvider, MockUrlFetcher } from '../src/adapters/mocks.js';

/**
 * No-DB route smoke tests via app.inject(). `/health` and the validation/error
 * envelope don't touch the database (postgres-js connects lazily), so these run
 * without Docker. DB-backed routes are covered in integration.test.ts.
 */
const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

describe('routes (no DB)', () => {
  it('GET /health → ok', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('listens on loopback by default and rejects a foreign Host (DNS rebinding)', async () => {
    expect(config.apiHost).toBe('localhost');
    const app = await buildApp({ config });
    const foreign = await app.inject({ method: 'GET', url: '/health', headers: { host: 'evil.example:3001' } });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json().error.code).toBe('forbidden_host');
    const local = await app.inject({ method: 'GET', url: '/health', headers: { host: '127.0.0.1:3001' } });
    expect(local.statusCode).toBe(200);
    await app.close();
  });

  it('accepts any Host when exposed on purpose with API_HOST=0.0.0.0', async () => {
    const exposed = loadConfig({ ...process.env, NODE_ENV: 'test', API_HOST: '0.0.0.0' } as NodeJS.ProcessEnv);
    const app = await buildApp({ config: exposed });
    const res = await app.inject({ method: 'GET', url: '/health', headers: { host: 'devbox.lan:3001' } });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('POST /settings/test-connection (github) returns structured ConnTestResult', async () => {
    const app = await buildApp({
      config,
      overrides: { github: new MockGitHubClient({ login: 'octocat' }) },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/settings/test-connection',
      payload: { provider: 'github' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.provider).toBe('github');
    expect(body.ok).toBe(true);
    expect(body.message).toContain('octocat');
    await app.close();
  });

  it('POST /settings/test-connection (openai) uses injected LLM listModels', async () => {
    const app = await buildApp({
      config,
      overrides: {
        llm: { openai: new MockLLMProvider('openai', { models: [{ id: 'gpt-4.1', provider: 'openai' }] }) },
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/settings/test-connection',
      payload: { provider: 'openai' },
    });
    expect(res.json().ok).toBe(true);
    await app.close();
  });

  it('returns 422 structured error on invalid body', async () => {
    const app = await buildApp({ config });
    const res = await app.inject({
      method: 'POST',
      url: '/settings/test-connection',
      payload: { provider: 'not-a-provider' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('validation_error');
    await app.close();
  });

  it('POST /skills/import/url refuses a non-https URL at the edge (422), before any fetch', async () => {
    const fetcher = new MockUrlFetcher({ 'http://x/': { body: '# never fetched' } });
    const app = await buildApp({ config, overrides: { urlFetcher: fetcher } });
    for (const url of ['http://x', 'ftp://x/a.md', 'not a url']) {
      const res = await app.inject({ method: 'POST', url: '/skills/import/url', payload: { url } });
      expect(res.statusCode, url).toBe(422);
      expect(res.json().error.code).toBe('validation_error');
    }
    expect(fetcher.calls).toEqual([]);
    await app.close();
  });
});
