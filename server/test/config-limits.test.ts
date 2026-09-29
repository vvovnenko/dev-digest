import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/platform/config.js';

/** REVIEW_CONCURRENCY and TRACE_RETENTION_DAYS: defaults, parsing, bounds. */
const base = { DATABASE_URL: 'postgres://u:p@127.0.0.1:1/db', NODE_ENV: 'test' } as NodeJS.ProcessEnv;

describe('config: review concurrency and trace retention', () => {
  it('runs 2 review requests at once and keeps traces 90 days by default', () => {
    const config = loadConfig({ ...base });
    expect(config.reviewConcurrency).toBe(2);
    expect(config.traceRetentionDays).toBe(90);
    expect(loadConfig({ ...base, REVIEW_CONCURRENCY: '', TRACE_RETENTION_DAYS: '' })).toMatchObject({
      reviewConcurrency: 2,
      traceRetentionDays: 90,
    });
    expect(loadConfig({ ...base, TRACE_RETENTION_DAYS: '0' }).traceRetentionDays).toBeNull(); // 0 turns it off
  });

  it('parses set values and refuses nonsense', () => {
    expect(loadConfig({ ...base, REVIEW_CONCURRENCY: '4', TRACE_RETENTION_DAYS: '30' })).toMatchObject({
      reviewConcurrency: 4,
      traceRetentionDays: 30,
    });
    expect(() => loadConfig({ ...base, REVIEW_CONCURRENCY: '0' })).toThrow();
    expect(() => loadConfig({ ...base, TRACE_RETENTION_DAYS: '-1' })).toThrow();
  });
});
