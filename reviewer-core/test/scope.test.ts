/**
 * applyIntentScope — deterministic out-of-scope filter (plan S3, decision U1, D6).
 * The model only FLAGS a finding as out_of_scope; this code decides what is dropped.
 * Source: docs/plans/2026-10-09-intent-layer.md (U1 line 26, D6 lines 136-139, S3 lines 301-306).
 */
import { describe, it, expect } from 'vitest';
import type { Finding } from '@devdigest/shared';
import { applyIntentScope } from '../src/scope.js';

type Intent = NonNullable<Parameters<typeof applyIntentScope>[1]>;

function finding(
  id: string,
  severity: Finding['severity'],
  extra: { out_of_scope?: boolean; confidence?: number } = {},
): Finding {
  return {
    id,
    severity,
    category: 'bug',
    title: `title ${id}`,
    file: 'src/a.ts',
    start_line: 1,
    end_line: 1,
    rationale: 'because',
    confidence: extra.confidence ?? 0.8,
    kind: 'finding',
    out_of_scope: extra.out_of_scope ?? false,
  } as Finding;
}

function intent(over: Partial<Intent> = {}): Intent {
  return {
    summary: 'Add rate limiting to public endpoints',
    in_scope: ['rate limiter'],
    out_of_scope: ['auth'],
    confidence: 'medium',
    stale: false,
    ...over,
  } as Intent;
}

const ids = (fs: Finding[]) => fs.map((f) => f.id);

describe('applyIntentScope', () => {
  it('(1) without intent keeps everything, resets out_of_scope to false, mode none', () => {
    const input = [
      finding('a', 'WARNING', { out_of_scope: true }),
      finding('b', 'CRITICAL', { out_of_scope: true }),
      finding('c', 'SUGGESTION'),
    ];
    const r = applyIntentScope(input);
    expect(r.mode).toBe('none');
    expect(ids(r.kept)).toEqual(['a', 'b', 'c']);
    expect(r.kept.map((f) => (f as { out_of_scope?: boolean }).out_of_scope)).toEqual([false, false, false]);
    expect(r.dropped).toEqual([]);
  });

  it('(2) filter mode drops out-of-scope WARNING and SUGGESTION with a reason, keeps in-scope', () => {
    const r = applyIntentScope(
      [
        finding('w-out', 'WARNING', { out_of_scope: true }),
        finding('s-out', 'SUGGESTION', { out_of_scope: true }),
        finding('w-in', 'WARNING'),
        finding('c-in', 'CRITICAL'),
      ],
      intent({ confidence: 'medium', stale: false }),
    );
    expect(r.mode).toBe('filter');
    expect(ids(r.kept)).toEqual(['w-in', 'c-in']);
    expect(r.dropped.map((d) => d.finding.id).sort()).toEqual(['s-out', 'w-out']);
    for (const d of r.dropped) expect(d.reason.length).toBeGreaterThan(0);
  });

  it('(3) of three out-of-scope CRITICALs (0.6/0.9/0.9) only the first 0.9 stays, flagged', () => {
    const r = applyIntentScope(
      [
        finding('c1', 'CRITICAL', { out_of_scope: true, confidence: 0.6 }),
        finding('c2', 'CRITICAL', { out_of_scope: true, confidence: 0.9 }),
        finding('c3', 'CRITICAL', { out_of_scope: true, confidence: 0.9 }),
      ],
      intent(),
    );
    expect(ids(r.kept)).toEqual(['c2']);
    expect((r.kept[0] as { out_of_scope?: boolean }).out_of_scope).toBe(true);
    expect(r.dropped.map((d) => d.finding.id).sort()).toEqual(['c1', 'c3']);
    for (const d of r.dropped) expect(d.reason.length).toBeGreaterThan(0);
  });

  it('(4) stale intent is tag-only: everything kept, flags preserved, nothing dropped', () => {
    const r = applyIntentScope(
      [
        finding('w-out', 'WARNING', { out_of_scope: true }),
        finding('c1', 'CRITICAL', { out_of_scope: true, confidence: 0.6 }),
        finding('c2', 'CRITICAL', { out_of_scope: true, confidence: 0.9 }),
        finding('w-in', 'WARNING'),
      ],
      intent({ stale: true }),
    );
    expect(r.mode).toBe('tag-only');
    expect(ids(r.kept)).toEqual(['w-out', 'c1', 'c2', 'w-in']);
    expect(r.kept.map((f) => (f as { out_of_scope?: boolean }).out_of_scope)).toEqual([true, true, true, false]);
    expect(r.dropped).toEqual([]);
  });

  it('(5) low-confidence intent is tag-only', () => {
    const r = applyIntentScope(
      [finding('w-out', 'WARNING', { out_of_scope: true }), finding('w-in', 'WARNING')],
      intent({ confidence: 'low', stale: false }),
    );
    expect(r.mode).toBe('tag-only');
    expect(ids(r.kept)).toEqual(['w-out', 'w-in']);
    expect((r.kept[0] as { out_of_scope?: boolean }).out_of_scope).toBe(true);
    expect(r.dropped).toEqual([]);
  });
});
