import { describe, it, expect } from 'vitest';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import { FAKE_FINDING_TITLE, FakeReviewLlm, firstAddedLine } from '../src/adapters/llm/fake.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { loadConfig } from '../src/platform/config.js';
import { IntentClassification } from '../src/modules/intent/domain.js';
import { INTENT_SCHEMA_NAME } from '../src/modules/intent/constants.js';

const RAW = [
  'diff --git a/src/config.ts b/src/config.ts',
  '--- a/src/config.ts',
  '+++ b/src/config.ts',
  '@@ -10,3 +10,4 @@',
  '   port: 3000,',
  '+  stripeKey: "sk_live_xxx",',
  '   redisUrl: x,',
].join('\n');

describe('FakeReviewLlm (DEVDIGEST_FAKE_LLM=1)', () => {
  it('finds the first added line of a diff', () => {
    expect(firstAddedLine(RAW)).toEqual({ file: 'src/config.ts', line: 11 });
    expect(firstAddedLine('no diff here')).toBeNull();
  });

  it('answers a real engine run with one finding that survives grounding', async () => {
    const outcome = await reviewPullRequest({
      systemPrompt: 's',
      model: 'fake-model',
      diff: parseUnifiedDiff(RAW),
      llm: new FakeReviewLlm('openrouter'),
    });
    expect(outcome.review.findings.map((f) => [f.title, f.file, f.start_line])).toEqual([
      [FAKE_FINDING_TITLE, 'src/config.ts', 11],
    ]);
  });

  it('answers the intent classifier with its deterministic intent', async () => {
    const res = await new FakeReviewLlm('openrouter').completeStructured({
      model: 'fake-model',
      schema: IntentClassification,
      schemaName: INTENT_SCHEMA_NAME,
      messages: [{ role: 'user', content: 'intent' }],
    });
    expect(res.data).toMatchObject({ confidence: 'medium', out_of_scope: [] });
    expect(res.data.summary.length).toBeGreaterThan(0);
  });

  it('is refused under production and off by default', () => {
    const base = { ...process.env, DATABASE_URL: 'postgres://x@localhost/x' } as NodeJS.ProcessEnv;
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', DEVDIGEST_FAKE_LLM: '1' })).toThrow(/tests only/);
    expect(loadConfig({ ...base, NODE_ENV: 'test', DEVDIGEST_FAKE_LLM: '1' }).fakeLlm).toBe(true);
    expect(loadConfig({ ...base, NODE_ENV: 'test' }).fakeLlm).toBe(false);
  });
});
