import { describe, it, expect } from 'vitest';
import { SkillCreate, SkillName } from '@devdigest/shared';
import {
  buildSkillDraft,
  configCandidatePaths,
  conventionPatch,
  createdFromNote,
  evidenceFilesOf,
  finalizeCandidates,
  languageFor,
  MAX_SKILL_BODY_CHARS,
  normalizeEvidencePath,
  numberLines,
  ruleFingerprint,
  ruleSlug,
  skillNameFor,
  verifyCandidates,
  type AcceptedConvention,
  type ExtractedCandidate,
  type VerifiedCandidate,
} from '../src/modules/conventions/domain.js';

const SERVICE_TS = [
  "import { z } from 'zod';",
  '',
  'export async function loadUser(id: string) {',
  '  const row = await db.users.find(id);',
  '',
  '  if (!row) throw new NotFoundError(`User ${id} not found`);',
  '  return row;',
  '}',
  '',
  'export async function loadTeam(id: string) {',
  '  const team = await db.teams.find(id);',
  "  if (!team) throw new NotFoundError('Team not found');",
  '  return team;',
  '}',
].join('\n');

const files = new Map([
  ['src/service.ts', `${SERVICE_TS}\n`],
  ['src/empty.ts', ''],
]);

const candidate = (evidence: Partial<ExtractedCandidate['evidence']>, rule = 'Throw NotFoundError for a missing row'): ExtractedCandidate => ({
  category: 'error_handling',
  rule,
  evidence: { file: 'src/service.ts', line: 6, end_line: null, snippet: '', ...evidence },
  confidence: 0.8,
});

describe('sampling', () => {
  it('config candidates: the repo root first, then each ancestor directory of the top files, deduped', () => {
    const paths = configCandidatePaths(['apps/web/src/page.tsx', 'apps/api/main.ts', './apps/web/lib/x.ts', '../evil.ts']);
    expect(paths[0]).toBe('tsconfig.json');
    expect(paths).toContain('.editorconfig');
    const dirs = [...new Set(paths.map((p) => p.slice(0, Math.max(0, p.lastIndexOf('/')))))];
    expect(dirs).toEqual(['', 'apps', 'apps/web', 'apps/api', 'apps/web/src', 'apps/web/lib']);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.some((p) => p.includes('..'))).toBe(false);
  });

  it('normalises a cited path, refusing absolute and parent paths', () => {
    expect(normalizeEvidencePath('./src/a.ts')).toBe('src/a.ts');
    expect(normalizeEvidencePath('src\\lib\\a.ts')).toBe('src/lib/a.ts');
    expect(normalizeEvidencePath('src//a.ts')).toBe('src/a.ts');
    expect(normalizeEvidencePath('/etc/passwd')).toBeNull();
    expect(normalizeEvidencePath('C:/repo/a.ts')).toBeNull();
    expect(normalizeEvidencePath('src/../../a.ts')).toBeNull();
    expect(normalizeEvidencePath('  ')).toBeNull();
  });

  it('numbers lines with a right-aligned gutter', () => {
    expect(numberLines(['a', 'b'], 9)).toBe('   9| a\n  10| b');
  });
});

describe('verifyCandidates', () => {
  it('keeps an exact citation and stores the real lines, not the model quote', () => {
    const { kept, dropped } = verifyCandidates(
      [candidate({ line: 6, snippet: '  if (!row)   throw new NotFoundError(`User ${id} not found`);' })],
      files,
    );
    expect(dropped).toEqual([]);
    expect(kept).toEqual([
      {
        category: 'error_handling',
        rule: 'Throw NotFoundError for a missing row',
        path: 'src/service.ts',
        startLine: 6,
        endLine: 6,
        snippet: '  if (!row) throw new NotFoundError(`User ${id} not found`);',
        confidence: 0.8,
      },
    ]);
  });

  it('accepts a citation off by up to three lines, and relocates one found elsewhere in the file', () => {
    const drift = verifyCandidates([candidate({ line: 9, snippet: "  if (!team) throw new NotFoundError('Team not found');" })], files);
    expect(drift.kept[0]).toMatchObject({ startLine: 12, endLine: 12 });
    const moved = verifyCandidates([candidate({ line: 1, snippet: "  if (!team) throw new NotFoundError('Team not found');" })], files);
    expect(moved.kept[0]).toMatchObject({ startLine: 12, endLine: 12 });
  });

  it('matches a multi-line snippet across blank lines and strips a copied gutter', () => {
    const { kept } = verifyCandidates(
      [
        candidate({
          line: 4,
          end_line: 7,
          snippet: '   4|   const row = await db.users.find(id);\n   6|   if (!row) throw new NotFoundError(`User ${id} not found`);\n   7|   return row;',
        }),
      ],
      files,
    );
    expect(kept[0]).toMatchObject({ startLine: 4, endLine: 7 });
    expect(kept[0]!.snippet.split('\n')).toHaveLength(4);
    expect(kept[0]!.snippet).toContain('\n\n');
  });

  it('drops bad paths, missing or empty files, lines out of range and snippets that are not there', () => {
    const { kept, dropped } = verifyCandidates(
      [
        candidate({ file: '../secrets.ts', snippet: 'return row;' }, 'r1'),
        candidate({ file: 'src/ghost.ts', snippet: 'return row;' }, 'r2'),
        candidate({ file: 'src/empty.ts', line: 1, snippet: 'return row;' }, 'r3'),
        candidate({ line: 99, snippet: '  return row;' }, 'r4'),
        candidate({ line: 0, snippet: '  return row;' }, 'r5'),
        candidate({ line: 6, snippet: 'throw new HttpError(404);' }, 'r6'),
        candidate({ line: 8, snippet: '}' }, 'r7'),
        candidate({ line: 6, snippet: '   \n  ' }, 'r8'),
      ],
      files,
    );
    expect(kept).toEqual([]);
    expect(dropped).toEqual([
      { rule: 'r1', reason: 'bad_path' },
      { rule: 'r2', reason: 'file_missing' },
      { rule: 'r3', reason: 'file_missing' },
      { rule: 'r4', reason: 'line_out_of_range' },
      { rule: 'r5', reason: 'line_out_of_range' },
      { rule: 'r6', reason: 'snippet_not_found' },
      { rule: 'r7', reason: 'snippet_not_found' },
      { rule: 'r8', reason: 'snippet_not_found' },
    ]);
  });

  it('caps the stored snippet at 15 lines', () => {
    const long = Array.from({ length: 30 }, (_, i) => `const value${i} = ${i};`).join('\n');
    const { kept } = verifyCandidates(
      [candidate({ file: 'long.ts', line: 1, end_line: 30, snippet: long })],
      new Map([['long.ts', long]]),
    );
    expect(kept[0]).toMatchObject({ startLine: 1, endLine: 15 });
    expect(kept[0]!.snippet.split('\n')).toHaveLength(15);
  });
});

describe('finalizeCandidates', () => {
  const v = (rule: string, confidence: number): VerifiedCandidate => ({
    category: 'naming',
    rule,
    path: 'a.ts',
    startLine: 1,
    endLine: 1,
    snippet: 'x',
    confidence,
  });

  it('clamps, drops low confidence, dedupes by fingerprint, skips decided rules and sorts', () => {
    const out = finalizeCandidates(
      [
        v('Use kebab-case file names', 0.7),
        v('use  kebab-case file names.', 0.9),
        v('Prefer named exports', 1.4),
        v('Rejected before', 0.95),
        v('Too unsure', 0.49),
        v('   ', 0.9),
      ],
      new Set([ruleFingerprint('Rejected before!')]),
    );
    expect(out.map((c) => [c.rule, c.confidence])).toEqual([
      ['Prefer named exports', 1],
      ['use kebab-case file names.', 0.9],
    ]);
    expect(out[1]!.fingerprint).toBe('use kebab-case file names');
  });

  it('keeps at most 20', () => {
    const many = Array.from({ length: 30 }, (_, i) => v(`Rule number ${i}`, 0.6 + i / 100));
    const out = finalizeCandidates(many, new Set());
    expect(out).toHaveLength(20);
    expect(out[0]!.rule).toBe('Rule number 29');
  });

  it('fingerprints ignore case, spacing and punctuation at the ends', () => {
    expect(ruleFingerprint('  Always use   async/await. ')).toBe('always use async/await');
    expect(ruleFingerprint('"Always use async/await"')).toBe('always use async/await');
  });

  it('a status change writes `accepted` in step; a rule edit alone does not touch it', () => {
    expect(conventionPatch({ status: 'accepted' })).toEqual({ status: 'accepted', accepted: true });
    expect(conventionPatch({ status: 'rejected' })).toEqual({ status: 'rejected', accepted: false });
    expect(conventionPatch({ rule: '  Use   zod  ' })).toEqual({ rule: 'Use zod' });
  });
});

describe('the skill draft', () => {
  it('slugs a rule from its significant words', () => {
    expect(ruleSlug('Always use async/await instead of .then() chains')).toBe('async-await-then-chains');
    expect(ruleSlug('Every route goes through getContext for the workspace id and never reads headers')).toBe(
      'route-getcontext-workspace-id-reads',
    );
    expect(ruleSlug('Always use the')).toBe('convention');
  });

  it('names the skill after the repo: a valid skill name of at most 64 chars', () => {
    expect(skillNameFor('Next.js_App')).toBe('next-js-app-conventions');
    expect(skillNameFor('payments-api')).toBe('payments-api-conventions');
    expect(skillNameFor('!!!')).toBe('repo-conventions');
    const long = skillNameFor('a-'.repeat(60));
    expect(long.length).toBeLessThanOrEqual(64);
    for (const name of [long, skillNameFor('Next.js_App'), skillNameFor('ÄÖÜ--x')]) {
      expect(SkillName.safeParse(name).success, name).toBe(true);
    }
  });

  it('picks the fence language from the file name', () => {
    expect(languageFor('src/a.ts')).toBe('ts');
    expect(languageFor('web/App.TSX')).toBe('tsx');
    expect(languageFor('.editorconfig')).toBe('ini');
    expect(languageFor('apps/web/.prettierrc')).toBe('json');
    expect(languageFor('Makefile')).toBe('');
  });

  const accepted: AcceptedConvention[] = [
    {
      rule: 'Always use async/await instead of .then() chains',
      evidencePath: 'src/api.ts',
      evidenceStartLine: 10,
      evidenceEndLine: 12,
      evidenceSnippet: 'async function a() {\n  await b();\n}',
    },
    {
      rule: 'Use async/await, not then chains',
      evidencePath: 'src/jobs.ts',
      evidenceStartLine: 4,
      evidenceEndLine: 4,
      evidenceSnippet: 'await run();',
    },
  ];

  it('builds the body in the design shape, with unique slugs', () => {
    const draft = buildSkillDraft({ repoName: 'payments-api', accepted });
    expect(draft).toMatchObject({
      name: 'payments-api-conventions',
      description: '2 house conventions extracted from payments-api',
      type: 'convention',
    });
    expect(draft.body).toBe(
      [
        '# payments-api-conventions',
        '',
        'House conventions for `payments-api`. Flag changes that violate any rule below and cite the offending `file:line`.',
        '',
        '## async-await-then-chains',
        'Always use async/await instead of .then() chains',
        '',
        'Detected in `src/api.ts:10-12`:',
        '```ts',
        'async function a() {',
        '  await b();',
        '}',
        '```',
        '',
        '## async-await-not-then-chains',
        'Use async/await, not then chains',
        '',
        'Detected in `src/jobs.ts:4`:',
        '```ts',
        'await run();',
        '```',
      ].join('\n'),
    );
    expect(SkillCreate.safeParse({ ...draft }).success).toBe(true);

    const twice = buildSkillDraft({ repoName: 'x', accepted: [accepted[0]!, accepted[0]!] });
    expect(twice.body).toContain('## async-await-then-chains\n');
    expect(twice.body).toContain('## async-await-then-chains-2\n');
    expect(buildSkillDraft({ repoName: 'x', accepted: [accepted[1]!] }).description).toBe(
      '1 house convention extracted from x',
    );
  });

  it('never emits a `+++ b/` line and gives a fenced snippet a longer fence', () => {
    const draft = buildSkillDraft({
      repoName: 'x',
      accepted: [
        { ...accepted[0]!, evidencePath: 'docs/a.md', evidenceSnippet: '+++ b/src/a.ts\n```js\nx\n```' },
      ],
    });
    expect(draft.body).not.toMatch(/^\+\+\+ b\//m);
    expect(draft.body).toContain('````markdown\n');
  });

  it('shrinks snippets, then drops sections, to stay within 40,000 characters', () => {
    const big = Array.from({ length: 15 }, (_, i) => `const line${i} = '${'x'.repeat(200)}';`).join('\n');
    const many: AcceptedConvention[] = Array.from({ length: 120 }, (_, i) => ({
      rule: `Rule ${i} ${'y'.repeat(400)}`,
      evidencePath: `src/f${i}.ts`,
      evidenceStartLine: 1,
      evidenceEndLine: 15,
      evidenceSnippet: big,
    }));
    const draft = buildSkillDraft({ repoName: 'x', accepted: many.slice(0, 20) });
    expect(draft.body.length).toBeLessThanOrEqual(MAX_SKILL_BODY_CHARS);
    expect(draft.body).toContain('## rule-0');
    expect(draft.body).toContain('## rule-19');

    const huge = buildSkillDraft({ repoName: 'x', accepted: many });
    expect(huge.body.length).toBeLessThanOrEqual(MAX_SKILL_BODY_CHARS);
    expect(huge.body).not.toContain('```');
    expect(huge.body).toContain('Detected in `src/f0.ts:1-15`.');
  });

  it('notes and evidence files for the created skill', () => {
    expect(createdFromNote(2, 'payments-api')).toBe('Created from 2 conventions in payments-api');
    expect(createdFromNote(1, 'x')).toBe('Created from 1 convention in x');
    expect(evidenceFilesOf([...accepted, accepted[0]!])).toEqual(['src/api.ts', 'src/jobs.ts']);
  });
});
