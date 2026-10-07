/**
 * reviewPullRequest — map-reduce, the derived verdict, what a failed run
 * reports as spent, and the size limits. Self-contained: a stub provider and a
 * hand-built two-file diff, no server mocks.
 */
import { describe, it, expect } from 'vitest';
import type { Finding, LLMProvider, Review, StructuredRequest, StructuredResult, UnifiedDiff } from '@devdigest/shared';
import {
  DiffTooLargeError,
  LlmCallError,
  NothingToReviewError,
  reviewPullRequest,
  DEFAULT_MAX_OUTPUT_TOKENS,
} from '../src/index.js';

/** Two files; new-side line 2 is added in each. */
const DIFF: UnifiedDiff = {
  raw: [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1 +1,2 @@',
    ' keep',
    '+const a = 1;',
    'diff --git a/src/b.ts b/src/b.ts',
    '--- a/src/b.ts',
    '+++ b/src/b.ts',
    '@@ -1 +1,2 @@',
    ' keep',
    '+const b = 2;',
  ].join('\n'),
  files: ['src/a.ts', 'src/b.ts'].map((path) => ({
    path,
    additions: 1,
    deletions: 0,
    hunks: [{ file: path, oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, newLineNumbers: [1, 2] }],
  })),
};

function finding(partial: Partial<Finding>): Finding {
  return {
    id: 'f',
    severity: 'CRITICAL',
    category: 'security',
    title: 'Secret committed',
    file: 'src/a.ts',
    start_line: 2,
    end_line: 2,
    rationale: 'r',
    confidence: 0.9,
    kind: 'finding',
    ...partial,
  };
}

type Reply = Review | Error;

/** Answers each call from `replies` in order and records the requests. */
function stub(replies: Reply[]) {
  const requests: StructuredRequest<unknown>[] = [];
  const llm: LLMProvider = {
    id: 'openrouter',
    async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
      requests.push(req as StructuredRequest<unknown>);
      const reply = replies[Math.min(requests.length - 1, replies.length - 1)]!;
      if (reply instanceof Error) throw reply;
      return { data: reply as T, model: req.model, tokensIn: 100, tokensOut: 50, costUsd: 0.001, raw: '{}', attempts: 1 };
    },
    async listModels() {
      return [];
    },
    async complete() {
      throw new Error('not used');
    },
    async embed() {
      return [];
    },
  };
  return { llm, requests };
}

const review = (findings: Finding[], verdict: Review['verdict'] = 'comment'): Review => ({
  verdict,
  summary: 's',
  score: 50,
  findings,
});

const userText = (req: StructuredRequest<unknown>) => req.messages.map((m) => m.content).join('\n');

describe('map-reduce', () => {
  it("sends each file's own slice and reports a finding both chunks return once", async () => {
    const dup = finding({ id: 'dup' });
    const { llm, requests } = stub([review([dup]), review([dup])]);
    const out = await reviewPullRequest({ systemPrompt: 's', model: 'm', diff: DIFF, llm, strategy: 'map-reduce' });

    expect(out.mode).toBe('map-reduce');
    expect(requests).toHaveLength(2);
    expect(userText(requests[0]!)).toContain('+const a = 1;');
    expect(userText(requests[0]!)).not.toContain('+const b = 2;');
    expect(userText(requests[1]!)).toContain('+const b = 2;');
    expect(out.review.findings).toHaveLength(1);
    expect(out.review.score).toBe(65); // one CRITICAL, not two
  });

  it('switches a too-large single pass to per-file chunks', async () => {
    const { llm, requests } = stub([review([])]);
    const out = await reviewPullRequest({
      systemPrompt: 's',
      model: 'm',
      diff: DIFF,
      llm,
      strategy: 'single-pass',
      singlePassMaxChars: 10,
    });
    expect(out.mode).toBe('map-reduce');
    expect(requests).toHaveLength(2);
  });
});

describe('verdict', () => {
  it('is derived from the grounded findings and the gate, not taken from the model', async () => {
    const run = async (findings: Finding[], modelVerdict: Review['verdict'], failOn?: 'critical' | 'warning') =>
      (await reviewPullRequest({ systemPrompt: 's', model: 'm', diff: DIFF, llm: stub([review(findings, modelVerdict)]).llm, ...(failOn ? { failOn } : {}) }))
        .review.verdict;

    expect(await run([], 'request_changes')).toBe('approve');
    expect(await run([finding({})], 'approve')).toBe('request_changes');
    expect(await run([finding({ severity: 'WARNING' })], 'request_changes')).toBe('comment');
    expect(await run([finding({ severity: 'WARNING' })], 'approve', 'warning')).toBe('request_changes');
    // A finding off the diff is dropped by grounding, so it can't drive the verdict.
    expect(await run([finding({ start_line: 99, end_line: 99 })], 'request_changes')).toBe('approve');
  });
});

describe('what a failed run spent', () => {
  it('carries the usage of earlier chunks plus the failed call', async () => {
    const failed = new LlmCallError('schema failed', { tokensIn: 10, tokensOut: 5, costUsd: 0.0002 });
    const { llm } = stub([review([]), failed]);
    const err = await reviewPullRequest({ systemPrompt: 's', model: 'm', diff: DIFF, llm, strategy: 'map-reduce' }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(LlmCallError);
    const { usage } = err as LlmCallError;
    expect([usage.tokensIn, usage.tokensOut]).toEqual([110, 55]);
    expect(usage.costUsd).toBeCloseTo(0.0012, 10);
    expect((err as LlmCallError).message).toContain('src/b.ts');
  });

  it('keeps earlier tokens but reports the cost as unknown when the failed call reported nothing', async () => {
    const { llm } = stub([review([]), new Error('socket hang up')]);
    const err = (await reviewPullRequest({ systemPrompt: 's', model: 'm', diff: DIFF, llm, strategy: 'map-reduce' }).catch(
      (e: unknown) => e,
    )) as LlmCallError;
    expect(err.usage).toEqual({ tokensIn: 100, tokensOut: 50, costUsd: null });
  });
});

describe('limits and forwarding', () => {
  it('caps output tokens by default and forwards the abort signal', async () => {
    const { llm, requests } = stub([review([])]);
    const signal = new AbortController().signal;
    await reviewPullRequest({ systemPrompt: 's', model: 'm', diff: DIFF, llm, signal });
    expect(requests[0]!.maxTokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    expect(requests[0]!.signal).toBe(signal);
  });

  it('refuses a diff over the size limit before any call', async () => {
    const { llm, requests } = stub([review([])]);
    await expect(reviewPullRequest({ systemPrompt: 's', model: 'm', diff: DIFF, llm, maxDiffChars: 10 })).rejects.toBeInstanceOf(
      DiffTooLargeError,
    );
    expect(requests).toHaveLength(0);
  });

  it('refuses an empty diff instead of approving it', async () => {
    const { llm, requests } = stub([review([])]);
    const empty: UnifiedDiff = { raw: '', files: [] };
    await expect(reviewPullRequest({ systemPrompt: 's', model: 'm', diff: empty, llm })).rejects.toBeInstanceOf(
      NothingToReviewError,
    );
    expect(requests).toHaveLength(0);
  });
});
