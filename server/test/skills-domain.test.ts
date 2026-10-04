import { describe, it, expect } from 'vitest';
import {
  applySkillPatch,
  buildImportDraft,
  classifyEntries,
  contentChanges,
  createNote,
  editNote,
  fallbackNameSource,
  findHiddenChars,
  restoreNote,
  slugifySkillName,
  splitFrontmatter,
  type SkillRecord,
} from '../src/modules/skills/domain.js';

const skill: SkillRecord = {
  id: 's1',
  workspaceId: 'w1',
  name: 'branch-coverage',
  description: 'Apply to new branches.',
  type: 'rubric',
  body: 'Flag untested branches.',
  source: 'manual',
  enabled: true,
  version: 3,
  evidenceFiles: null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
};

describe('skill versions', () => {
  it('a content change bumps the version and snapshots the merged content', () => {
    const change = applySkillPatch(skill, { body: 'New body', description: 'New description' });
    expect(change).toEqual({
      set: { body: 'New body', description: 'New description', version: 4 },
      snapshot: {
        version: 4,
        note: 'Edited body, description',
        content: { name: 'branch-coverage', description: 'New description', type: 'rubric', body: 'New body' },
      },
    });
  });

  it('toggling enabled alone writes no version; an unchanged patch writes nothing', () => {
    expect(applySkillPatch(skill, { enabled: false })).toEqual({ set: { enabled: false }, snapshot: null });
    expect(applySkillPatch(skill, { enabled: true, body: skill.body })).toBeNull();
    expect(applySkillPatch(skill, {})).toBeNull();
  });

  it('notes name the changed fields in a fixed order', () => {
    expect(contentChanges(skill, { type: 'security', name: 'x' })).toEqual(['name', 'type']);
    expect(editNote(['type', 'body', 'name'])).toBe('Edited body, name, type');
    expect(createNote()).toBe('Created');
    expect(createNote('flaky.zip')).toBe('Imported from flaky.zip');
    expect(restoreNote(2)).toBe('Restored v2');
    expect(applySkillPatch(skill, { body: 'old' }, restoreNote(1))!.snapshot!.note).toBe('Restored v1');
  });
});

describe('skill names', () => {
  it('slugify turns any text into a kebab-case name', () => {
    expect(slugifySkillName('Flaky Test Patterns')).toBe('flaky-test-patterns');
    expect(slugifySkillName('  Ünïcode_v2!! ')).toBe('unicode-v2');
    expect(slugifySkillName('---')).toBe('');
    expect(slugifySkillName('a'.repeat(70) + '-b')).toHaveLength(64);
  });

  it('the fallback name comes from the folder, then the file, then the upload', () => {
    expect(fallbackNameSource('flaky-test-patterns/SKILL.md', 'x.zip')).toBe('flaky-test-patterns');
    expect(fallbackNameSource('edge-cases.md', 'edge-cases.md')).toBe('edge-cases');
    expect(fallbackNameSource('SKILL.md', 'my-skill.zip')).toBe('my-skill');
  });
});

describe('archive entries', () => {
  const e = (path: string, size = 10) => ({ path, size });

  it('picks the shallowest SKILL.md and says why every other entry is left out', () => {
    const { main, skipped } = classifyEntries([
      e('flaky/'),
      e('flaky/SKILL.md'),
      e('flaky/scripts/find-sleeps.sh'),
      e('flaky/run.py'),
      e('flaky/references/more.md'),
      e('flaky/logo.png'),
      e('__MACOSX/flaky/._SKILL.md'),
      e('flaky/.DS_Store'),
      e('../evil.md'),
    ]);
    expect(main).toBe('flaky/SKILL.md');
    expect(Object.fromEntries(skipped.map((s) => [s.path, s.reason]))).toEqual({
      'flaky/scripts/find-sleeps.sh': 'script',
      'flaky/run.py': 'script',
      'flaky/references/more.md': 'extra_markdown',
      'flaky/logo.png': 'not_markdown',
      '__MACOSX/flaky/._SKILL.md': 'os_metadata',
      'flaky/.DS_Store': 'os_metadata',
      '../evil.md': 'unsafe_path',
    });
  });

  it('falls back to the only markdown file; refuses none or several', () => {
    expect(classifyEntries([e('rules.md'), e('x.sh')]).main).toBe('rules.md');
    expect(() => classifyEntries([e('x.sh')])).toThrow(/no SKILL.md/);
    expect(() => classifyEntries([e('a.md'), e('b.md')])).toThrow(/several markdown files/);
    expect(() => classifyEntries([e('a/SKILL.md'), e('b/SKILL.md')])).toThrow(/more than one SKILL.md/);
  });
});

describe('import text', () => {
  it('splits frontmatter, tolerating a BOM and CRLF', () => {
    expect(splitFrontmatter('﻿---\r\nname: x\r\n---\r\n# Body\r\n')).toEqual({
      frontmatter: 'name: x',
      body: '# Body\n',
      unterminated: false,
    });
    expect(splitFrontmatter('# No frontmatter')).toEqual({ frontmatter: null, body: '# No frontmatter', unterminated: false });
    expect(splitFrontmatter('---\nname: x\n# never closed').unterminated).toBe(true);
  });

  it('finds invisible characters and their lines', () => {
    expect(findHiddenChars('ok\nzero​width\nbidi‮flip')).toEqual({ count: 2, lines: [2, 3] });
    expect(findHiddenChars('tag\u{E0041}')).toEqual({ count: 1, lines: [1] });
    expect(findHiddenChars('plain')).toEqual({ count: 0, lines: [] });
  });

  it('builds a draft and turns every frontmatter problem into a warning', () => {
    const { draft, warnings } = buildImportDraft({
      frontmatter: { name: 'Flaky Tests', description: 'Apply when\n  tests change.', type: 'weird', 'allowed-tools': 'Bash' },
      body: '\nRun scripts/find-sleeps.sh first.\n',
      fallbackName: 'flaky',
      skipped: [{ path: 'flaky/scripts/find-sleeps.sh', reason: 'script' }],
    });
    expect(draft).toEqual({
      name: 'flaky-tests',
      description: 'Apply when tests change.',
      type: 'custom',
      body: 'Run scripts/find-sleeps.sh first.',
    });
    expect(warnings.map((w) => w.code).sort()).toEqual(
      ['invalid_type', 'name_derived', 'skipped_file_referenced', 'unknown_frontmatter_key'].sort(),
    );
    expect(warnings.find((w) => w.code === 'unknown_frontmatter_key')!.detail).toBe('allowed-tools');
  });

  it('names a nameless skill after its fallback, and flags a missing description and hidden characters', () => {
    const { draft, warnings } = buildImportDraft({
      frontmatter: null,
      body: 'line one\nsneaky​line',
      fallbackName: 'Edge Cases',
      skipped: [],
    });
    expect(draft.name).toBe('edge-cases');
    expect(draft.type).toBe('custom');
    expect(warnings).toContainEqual({ code: 'missing_description' });
    expect(warnings).toContainEqual({ code: 'hidden_characters', detail: '1 invisible character(s) on line(s) 2' });
  });

  it('refuses an empty or oversized body', () => {
    const base = { frontmatter: null, fallbackName: 'x', skipped: [] };
    expect(() => buildImportDraft({ ...base, body: '  \n ' })).toThrow(/no instructions/);
    expect(() => buildImportDraft({ ...base, body: 'a'.repeat(40_001) })).toThrow(/longer than 40000/);
    const large = buildImportDraft({ ...base, body: 'a'.repeat(20_000) });
    expect(large.warnings.map((w) => w.code)).toContain('large_body');
  });
});
