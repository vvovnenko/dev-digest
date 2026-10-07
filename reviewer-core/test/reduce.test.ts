import { describe, it, expect } from 'vitest';
import type { Finding, Review, UnifiedDiff } from '@devdigest/shared';
import { reduceReviews, sliceDiff } from '../src/review/reduce.js';

const RAW = [
  'diff --git a/lib/x.ts b/lib/x.ts',
  '--- a/lib/x.ts',
  '+++ b/lib/x.ts',
  '@@ -1 +1,2 @@',
  ' a',
  '+lib change',
  'diff --git a/x.ts b/x.ts',
  '--- a/x.ts',
  '+++ b/x.ts',
  '@@ -1 +1,2 @@',
  ' b',
  '+root change',
].join('\n');

const diff: UnifiedDiff = { raw: RAW, files: [] };

function f(partial: Partial<Finding>): Finding {
  return {
    id: 'x',
    severity: 'WARNING',
    category: 'bug',
    title: 'Null check missing',
    file: 'x.ts',
    start_line: 2,
    end_line: 2,
    rationale: 'r',
    confidence: 0.8,
    ...partial,
  };
}

const review = (findings: Finding[], verdict: Review['verdict'] = 'comment'): Review => ({
  verdict,
  summary: 's',
  score: 80,
  findings,
});

describe('sliceDiff', () => {
  it("takes only the file's own block, not one whose path ends the same", () => {
    const slice = sliceDiff(diff, 'x.ts');
    expect(slice).toContain('+root change');
    expect(slice).not.toContain('+lib change');
    expect(slice.startsWith('diff --git a/x.ts b/x.ts')).toBe(true);
  });

  it('returns an empty string for a path with no block (the caller skips it)', () => {
    expect(sliceDiff(diff, 'missing.ts')).toBe('');
  });
});

describe('reduceReviews', () => {
  it('reports a finding once when two chunks return it', () => {
    const merged = reduceReviews([
      review([f({ id: 'a' })]),
      review([f({ id: 'b', title: '  null CHECK   missing ' }), f({ id: 'c', start_line: 7, end_line: 7 })]),
    ]);
    expect(merged.findings.map((x) => x.id)).toEqual(['a', 'c']);
  });

  it('de-duplicates a single chunk too, and keeps the worst verdict across chunks', () => {
    expect(reduceReviews([review([f({ id: 'a' }), f({ id: 'b' })])]).findings).toHaveLength(1);
    expect(reduceReviews([review([], 'approve'), review([], 'request_changes')]).verdict).toBe('request_changes');
  });
});
