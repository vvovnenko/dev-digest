import { describe, it, expect } from 'vitest';
import type { IntentSource } from '@devdigest/shared';
import {
  confidenceCap,
  extractReferences,
  fileOutline,
  finalizeIntent,
  intentFreshness,
  normalizeIntentInput,
} from '../src/modules/intent/domain.js';

/**
 * Intent domain (plan S5, docs/plans/2026-10-09-intent-layer.md): the link
 * parser table (§2), the confidence cap (Amendment A2), finalizeIntent,
 * fileOutline and the staleness rule (D5). Pure functions, no doubles.
 *
 * Assumed shapes (the plan names the functions only):
 * - extractReferences({ title, body, branch, repo }) → { kind, ref, status: 'pending' | 'skipped' | 'unavailable', reason }[]
 *   ('pending' = to be fetched); the first five distinct links stay pending.
 * - confidenceCap(sources) → 'high' | 'medium' | 'low'
 * - finalizeIntent({ classification, sources }) → { summary, in_scope, out_of_scope, confidence, missing_context }
 * - fileOutline(raw) → { text, files, hunks, truncated }
 * - intentFreshness(stored | null, current) → { stale, reason }
 * - normalizeIntentInput({ title, body }) → { title, body }
 */

const REPO = { owner: 'acme', name: 'payments-api' };
const refs = (input: { title?: string; body?: string | null; branch?: string }) =>
  extractReferences({ title: '', body: null, branch: 'feat/x', repo: REPO, ...input });

describe('extractReferences: source table', () => {
  it('#N is an issue to fetch (plan §2 table, row 1)', () => {
    expect(refs({ body: 'Closes #12' })).toMatchObject([{ kind: 'issue', ref: '#12', status: 'pending', reason: null }]);
  });

  it('owner/repo#N is an issue, keeping the owner/repo in ref', () => {
    expect(refs({ body: 'See acme/api#9' })).toMatchObject([
      { kind: 'issue', ref: 'acme/api#9', status: 'pending', reason: null },
    ]);
  });

  it('a github issues URL is an issue and a pull URL is a pull', () => {
    expect(refs({ body: 'https://github.com/acme/api/issues/9' })).toMatchObject([
      { kind: 'issue', ref: 'acme/api#9', status: 'pending' },
    ]);
    expect(refs({ body: 'https://github.com/acme/api/pull/9' })).toMatchObject([
      { kind: 'pull', ref: 'acme/api#9', status: 'pending' },
    ]);
  });

  it('a blob URL of this repo is a repo_file to fetch, ref is the path only', () => {
    const found = refs({ body: 'Spec: https://github.com/acme/payments-api/blob/main/docs/plan.md' });
    expect(found).toMatchObject([{ kind: 'repo_file', ref: 'docs/plan.md', status: 'pending', reason: null }]);
    expect(found).toHaveLength(1);
  });

  it.each(['md', 'mdx', 'txt', 'rst', 'adoc'])('a bare path ending .%s is a repo_file', (ext) => {
    expect(refs({ body: `See docs/plan.${ext} for details` })).toMatchObject([
      { kind: 'repo_file', ref: `docs/plan.${ext}`, status: 'pending', reason: null },
    ]);
  });

  it('src/x.ts is not a reference', () => {
    expect(refs({ title: 'Touch src/x.ts', body: 'Changes src/x.ts and lib/y.js' })).toEqual([]);
  });

  it('a blob URL of another repo is skipped: other_repo', () => {
    expect(refs({ body: 'https://github.com/acme/other/blob/main/docs/x.md' })).toMatchObject([
      { kind: 'repo_file', status: 'skipped', reason: 'other_repo' },
    ]);
  });

  it.each(['md', 'markdown', 'txt'])('an https URL with a .%s path is a url to fetch, ref is host + path', (ext) => {
    expect(refs({ body: `https://example.com/docs/spec.${ext}` })).toMatchObject([
      { kind: 'url', ref: `example.com/docs/spec.${ext}`, status: 'pending', reason: null },
    ]);
  });

  it('strips query, fragment and userinfo from ref', () => {
    const found = refs({ body: 'https://user:pw@example.com/spec.md?token=abc123#part' });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'url', ref: 'example.com/spec.md' });
    expect(JSON.stringify(found[0]!.ref)).not.toMatch(/token|abc123|user|pw|#/);
  });

  it('any other https URL is skipped: unsupported_type', () => {
    expect(refs({ body: 'https://example.com/page' })).toMatchObject([
      { kind: 'url', ref: 'example.com/page', status: 'skipped', reason: 'unsupported_type' },
    ]);
  });

  it('http:// is skipped: insecure', () => {
    expect(refs({ body: 'http://example.com/spec.md' })).toMatchObject([
      { kind: 'url', ref: 'example.com/spec.md', status: 'skipped', reason: 'insecure' },
    ]);
  });

  it('a Jira-style key is a ticket, unavailable: no_integration', () => {
    expect(refs({ body: 'Implements PAY-12' })).toMatchObject([
      { kind: 'ticket', ref: 'PAY-12', status: 'unavailable', reason: 'no_integration' },
    ]);
  });

  it('atlassian.net and linear.app URLs are tickets, not urls', () => {
    const jira = refs({ body: 'https://acme.atlassian.net/browse/PAY-12' });
    expect(jira).toMatchObject([{ kind: 'ticket', ref: 'PAY-12', status: 'unavailable', reason: 'no_integration' }]);
    expect(jira).toHaveLength(1);
    const linear = refs({ body: 'https://linear.app/acme/issue/ENG-5/some-title' });
    expect(linear).toMatchObject([{ kind: 'ticket', ref: 'ENG-5', status: 'unavailable', reason: 'no_integration' }]);
    expect(linear).toHaveLength(1);
  });

  it('SHA-256, UTF-8 and CVE-2024-1 are not ticket keys', () => {
    expect(refs({ title: 'Use SHA-256', body: 'Encode as UTF-8, fixes CVE-2024-1' })).toEqual([]);
  });

  it('every denylisted prefix is ignored', () => {
    const body = 'SHA-1 UTF-8 ISO-8601 RFC-7231 CVE-2024-1 HTTP-2 TLS-13 AES-256 UTC-5';
    expect(refs({ body })).toEqual([]);
  });

  it('takes a ticket key from the branch name, and only an uppercase one', () => {
    expect(refs({ branch: 'feature/PAY-12-add-limit' })).toMatchObject([
      { kind: 'ticket', ref: 'PAY-12', status: 'unavailable', reason: 'no_integration' },
    ]);
    expect(refs({ branch: 'feature/pay-12-add-limit' })).toEqual([]);
  });

  it('finds links in the title as well as the body, title first', () => {
    expect(refs({ title: 'Fix #1', body: 'and #2' }).map((r) => r.ref)).toEqual(['#1', '#2']);
  });

  it('collapses duplicates', () => {
    expect(refs({ title: 'Fix #12', body: '#12 and again #12, PAY-1 PAY-1' }).map((r) => r.ref)).toEqual([
      '#12',
      'PAY-1',
    ]);
  });

  it('the sixth link is skipped: limit; five distinct links all stay to fetch', () => {
    const six = refs({ body: '#1 #2 #3 #4 #5 #6' });
    expect(six).toHaveLength(6);
    expect(six.slice(0, 5).map((r) => r.status)).toEqual(['pending', 'pending', 'pending', 'pending', 'pending']);
    expect(six[5]).toMatchObject({ ref: '#6', status: 'skipped', reason: 'limit' });

    const five = refs({ body: '#1 #1 #1 #2 #3 #4 #5' });
    expect(five.map((r) => r.status)).toEqual(['pending', 'pending', 'pending', 'pending', 'pending']);
  });
});

const src = (kind: IntentSource['kind'], status: IntentSource['status'], reason: string | null = null, ref: string = kind): IntentSource => ({
  kind,
  ref,
  status,
  reason,
  chars: status === 'used' ? 100 : 0,
});
const TITLE = src('title', 'used');
const FILES = src('files', 'used');
const DESC = src('description', 'used');
const DESC_EMPTY = src('description', 'skipped', 'empty');

describe('confidenceCap (Amendment A2)', () => {
  it('empty description, no links → low', () => {
    expect(confidenceCap([TITLE, DESC_EMPTY, FILES])).toBe('low');
  });

  it('empty description + a fetched issue → high', () => {
    expect(confidenceCap([TITLE, DESC_EMPTY, FILES, src('issue', 'used', null, '#5')])).toBe('high');
  });

  it('a description without links → medium', () => {
    expect(confidenceCap([TITLE, DESC, FILES])).toBe('medium');
  });

  it('a description + an unavailable link → medium', () => {
    expect(confidenceCap([TITLE, DESC, FILES, src('issue', 'unavailable', 'not_found', '#999')])).toBe('medium');
  });

  it('a description + every link fetched → high', () => {
    expect(confidenceCap([TITLE, DESC, FILES, src('issue', 'used', null, '#5')])).toBe('high');
  });

  it('a truncated link counts as fetched', () => {
    expect(confidenceCap([TITLE, DESC, FILES, src('url', 'truncated', null, 'example.com/a.md')])).toBe('high');
  });

  it('a skipped link (not "empty") counts as missing → medium', () => {
    expect(confidenceCap([TITLE, DESC, FILES, src('issue', 'used', null, '#1'), src('repo_file', 'skipped', 'other_repo')])).toBe(
      'medium',
    );
  });

  it('empty description with only an unavailable link → low', () => {
    expect(confidenceCap([TITLE, DESC_EMPTY, FILES, src('issue', 'unavailable', 'not_found', '#9')])).toBe('low');
  });
});

const classification = (over: Partial<{ summary: string; in_scope: string[]; out_of_scope: string[]; confidence: 'high' | 'medium' | 'low'; missing_context: string[] }> = {}) => ({
  summary: 'Adds rate limiting to the public API.',
  in_scope: ['src/middleware/ratelimit.ts'],
  out_of_scope: ['auth'],
  confidence: 'high' as const,
  missing_context: [] as string[],
  ...over,
});

describe('finalizeIntent', () => {
  it('model high with cap medium → medium', () => {
    const sources = [TITLE, DESC, FILES, src('issue', 'unavailable', 'not_found', '#999')];
    expect(finalizeIntent({ classification: classification({ confidence: 'high' }), sources }).confidence).toBe('medium');
  });

  it('model low with cap high → low', () => {
    const sources = [TITLE, DESC, FILES, src('issue', 'used', null, '#5')];
    expect(finalizeIntent({ classification: classification({ confidence: 'low' }), sources }).confidence).toBe('low');
  });

  it('model medium with cap medium → medium; model high with cap high → high', () => {
    expect(finalizeIntent({ classification: classification({ confidence: 'medium' }), sources: [TITLE, DESC, FILES] }).confidence).toBe(
      'medium',
    );
    const linked = [TITLE, DESC, FILES, src('issue', 'used', null, '#5')];
    expect(finalizeIntent({ classification: classification({ confidence: 'high' }), sources: linked }).confidence).toBe('high');
  });

  it('missing_context lists each unavailable source as "<ref>: <reason>", and nothing for a skipped one', () => {
    const sources = [
      TITLE,
      DESC,
      FILES,
      src('issue', 'unavailable', 'not_found', '#999'),
      src('ticket', 'unavailable', 'no_integration', 'PAY-1'),
      src('repo_file', 'skipped', 'other_repo', 'x/y.md'),
    ];
    expect(finalizeIntent({ classification: classification(), sources }).missing_context).toEqual([
      '#999: not_found',
      'PAY-1: no_integration',
    ]);
  });

  it('an empty description is no missing context and the confidence is low whatever the model says', () => {
    const out = finalizeIntent({ classification: classification({ confidence: 'high' }), sources: [TITLE, DESC_EMPTY, FILES] });
    expect(out.missing_context).toEqual([]);
    expect(out.confidence).toBe('low');
    expect(out.summary).toBe('Adds rate limiting to the public API.');
  });

  it('keeps the model summary and scopes, and truncates oversized lists and text (limits not in the plan)', () => {
    const many = Array.from({ length: 100 }, (_, i) => `item ${i}`);
    const out = finalizeIntent({
      classification: classification({ summary: 'x'.repeat(5000), in_scope: many, out_of_scope: many }),
      sources: [TITLE, DESC, FILES],
    });
    expect(out.summary.length).toBeLessThan(5000);
    expect(out.in_scope.length).toBeGreaterThan(0);
    expect(out.in_scope.length).toBeLessThan(100);
    expect(out.in_scope).toEqual(many.slice(0, out.in_scope.length));
    expect(out.out_of_scope.length).toBeLessThan(100);
  });
});

const file = (path: string, hunks: string[], body = ['+  added', '-  removed']) =>
  [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    ...hunks.flatMap((h) => [h, '   keepme', ...body]),
  ].join('\n');

describe('fileOutline', () => {
  it('lists path, +added/-deleted and the @@ header with its function context, never a body line', () => {
    const raw = file('src/a.ts', ['@@ -10,3 +10,4 @@ export function foo() {'], [
      '+  const secretBody = 1;',
      '-  const oldBody = 2;',
    ]);
    const out = fileOutline(raw);
    expect(out.text).toContain('src/a.ts');
    expect(out.text).toContain('@@ -10,3 +10,4 @@ export function foo() {');
    expect(out.text).toMatch(/\+1/);
    expect(out.text).toMatch(/[-−–]1/);
    expect(out.text).not.toContain('secretBody');
    expect(out.text).not.toContain('oldBody');
    expect(out.text).not.toContain('keepme');
    expect(out.text).not.toContain('+++ b/');
    expect(out.text).not.toContain('--- a/');
    expect(out).toMatchObject({ files: 1, hunks: 1, truncated: false });
  });

  it('keeps at most 20 hunks of a file and says it truncated', () => {
    const headers = Array.from({ length: 30 }, (_, i) => `@@ -${i + 1},1 +${i + 1},1 @@ fn${i}()`);
    const out = fileOutline(file('src/big.ts', headers));
    expect(out.text.match(/@@ -/g)).toHaveLength(20);
    expect(out.text).toContain('fn0()');
    expect(out.text).not.toContain('fn29()');
    expect(out.truncated).toBe(true);
  });

  it('keeps at most 200 files and 8 000 characters', () => {
    const raw = Array.from({ length: 201 }, (_, i) =>
      file(`src/some/long/directory/name/file-${String(i).padStart(3, '0')}.ts`, [`@@ -1,1 +1,1 @@ function number${i}()`]),
    ).join('\n');
    const out = fileOutline(raw);
    expect(out.files).toBeLessThanOrEqual(200);
    expect(out.text.length).toBeLessThanOrEqual(8000);
    expect(out.truncated).toBe(true);
  });
});

describe('intentFreshness (D5)', () => {
  const current = { headSha: 'bbb', inputHash: 'h1' };

  it('head changed → stale: head_changed', () => {
    expect(intentFreshness({ headSha: 'aaa', inputHash: 'h1' }, current)).toEqual({ stale: true, reason: 'head_changed' });
  });

  it('description changed → stale: description_changed', () => {
    expect(intentFreshness({ headSha: 'bbb', inputHash: 'other' }, current)).toEqual({
      stale: true,
      reason: 'description_changed',
    });
  });

  it('a stored input_hash of null is not compared', () => {
    expect(intentFreshness({ headSha: 'bbb', inputHash: null }, current)).toEqual({ stale: false, reason: null });
  });

  it('no stored result → not stale', () => {
    expect(intentFreshness(null, current)).toEqual({ stale: false, reason: null });
  });

  it('same head and same hash → fresh', () => {
    expect(intentFreshness({ headSha: 'bbb', inputHash: 'h1' }, current)).toEqual({ stale: false, reason: null });
  });
});

describe('normalizeIntentInput', () => {
  it('a null body is an empty body', () => {
    expect(normalizeIntentInput({ title: 'T', body: null })).toEqual(normalizeIntentInput({ title: 'T', body: '' }));
  });

  it('surrounding whitespace and CRLF do not change the result', () => {
    expect(normalizeIntentInput({ title: '  Fix it ', body: 'line1\r\nline2\n' })).toEqual(
      normalizeIntentInput({ title: 'Fix it', body: 'line1\nline2' }),
    );
  });

  it('a different body gives a different result', () => {
    expect(normalizeIntentInput({ title: 'T', body: 'one' })).not.toEqual(normalizeIntentInput({ title: 'T', body: 'two' }));
  });

  it('cuts the title to 256 and the body to 4000 characters', () => {
    const out = normalizeIntentInput({ title: 't'.repeat(300), body: 'b'.repeat(5000) });
    expect(out.title).toHaveLength(256);
    expect(out.body).toHaveLength(4000);
  });
});
