/**
 * groundFindings — the engine's own coverage of two ways model output could get
 * past the gate: a huge line range (used to be counted line by line) and a
 * file-level `kind` (used to skip the line check for any caller).
 */
import { describe, it, expect } from 'vitest';
import type { Finding, UnifiedDiff } from '@devdigest/shared';
import { groundFindings } from '../src/grounding.js';

/** One file whose hunk covers new-side lines 10–11. */
const diff: UnifiedDiff = {
  raw: '',
  files: [
    {
      path: 'src/a.ts',
      additions: 2,
      deletions: 0,
      hunks: [{ file: 'src/a.ts', oldStart: 10, oldLines: 0, newStart: 10, newLines: 2, newLineNumbers: [10, 11] }],
    },
  ],
};

function f(partial: Partial<Finding>): Finding {
  return {
    id: 'x',
    severity: 'WARNING',
    category: 'bug',
    title: 't',
    file: 'src/a.ts',
    start_line: 10,
    end_line: 10,
    rationale: 'r',
    confidence: 0.8,
    ...partial,
  };
}

describe('groundFindings — model-chosen line ranges', () => {
  it('handles an absurd range without counting through it', () => {
    const started = Date.now();
    const res = groundFindings(
      [
        f({ start_line: 1, end_line: Number.MAX_SAFE_INTEGER }), // covers 10–11 → kept
        f({ start_line: 1_000, end_line: Number.MAX_SAFE_INTEGER }), // covers nothing → dropped
      ],
      diff,
    );
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(res.kept).toHaveLength(1);
    expect(res.dropped).toHaveLength(1);
  });

  it('still treats a reversed range as a range', () => {
    expect(groundFindings([f({ start_line: 11, end_line: 5 })], diff).kept).toHaveLength(1);
  });
});

describe('groundFindings — file-level kinds are opt-in', () => {
  const offHunkHook = f({ kind: 'hook', start_line: 500, end_line: 500 });

  it('line-grounds every kind by default (model output picks its own kind)', () => {
    const res = groundFindings([offHunkHook], diff);
    expect(res.kept).toHaveLength(0);
    expect(res.dropped[0]!.reason).toMatch(/do not intersect/);
  });

  it('lets deterministic scanners ground file-level kinds against the file', () => {
    expect(groundFindings([offHunkHook], diff, { fileLevelKinds: true }).kept).toHaveLength(1);
  });

  it('still drops a file-level finding for a file outside the diff', () => {
    const res = groundFindings([f({ kind: 'hook', file: 'src/other.ts' })], diff, { fileLevelKinds: true });
    expect(res.kept).toHaveLength(0);
  });
});
