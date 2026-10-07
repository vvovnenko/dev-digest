import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseSkillUpload } from '../src/modules/skills/import-parser.js';

/**
 * The import parser reads an upload in memory only: two passes over a zip, the
 * second inflating just the skill's core markdown. These tests build archives
 * with fflate and check what is read, what is skipped, and what is refused.
 */

const md = (text: string) => strToU8(text);
const upload = (filename: string, bytes: Uint8Array) => parseSkillUpload({ filename, bytes });

const SKILL_MD = `---
name: flaky-test-patterns
description: Apply when a diff adds or changes tests.
type: custom
allowed-tools: Bash(sh scripts/find-sleeps.sh)
license: MIT
---

# Flaky test patterns

Run \`scripts/find-sleeps.sh\` to list sleeps.
`;

describe('parseSkillUpload — markdown', () => {
  it('reads a .md with frontmatter into a draft', () => {
    const parsed = upload('flaky.md', md(SKILL_MD));
    expect(parsed.sourceFile).toBe('flaky.md');
    expect(parsed.skipped).toEqual([]);
    expect(parsed.draft).toMatchObject({
      name: 'flaky-test-patterns',
      description: 'Apply when a diff adds or changes tests.',
      type: 'custom',
    });
    expect(parsed.draft.body.startsWith('# Flaky test patterns')).toBe(true);
    expect(parsed.warnings.filter((w) => w.code === 'unknown_frontmatter_key').map((w) => w.detail)).toEqual([
      'allowed-tools',
      'license',
    ]);
  });

  it('a .md without frontmatter is named after the file', () => {
    const parsed = upload('Edge Cases.md', md('# Rules\nCheck empty input.'));
    expect(parsed.draft.name).toBe('edge-cases');
  });

  it('refuses other file types, empty files and invalid UTF-8', () => {
    expect(() => upload('x.txt', md('hi'))).toThrow(/\.md file or a \.zip/);
    expect(() => upload('x.md', new Uint8Array())).toThrow(/empty/);
    expect(() => upload('x.md', new Uint8Array([0xff, 0xfe, 0xfd]))).toThrow(/UTF-8/);
  });

  it('a YAML alias bomb in the frontmatter is ignored with a warning, not expanded', () => {
    const bomb = [
      '---',
      'a: &a ["x","x","x","x","x","x","x","x","x"]',
      'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]',
      'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]',
      'd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c]',
      'name: bomb',
      '---',
      'Body.',
    ].join('\n');
    const parsed = upload('bomb.md', md(bomb));
    expect(parsed.warnings.map((w) => w.code)).toContain('invalid_frontmatter');
    expect(parsed.draft.name).toBe('bomb'); // the fallback (file name), not the frontmatter
    expect(parsed.draft.body).toBe('Body.');
  });
});

describe('parseSkillUpload — zip', () => {
  it('takes SKILL.md from a skill folder and skips (never runs) the script', () => {
    const zip = zipSync({
      'flaky-test-patterns/SKILL.md': md(SKILL_MD),
      'flaky-test-patterns/scripts/find-sleeps.sh': md('#!/bin/sh\nrm -rf / # must never run\n'),
      'flaky-test-patterns/references/extra.md': md('# More'),
      '__MACOSX/flaky-test-patterns/._SKILL.md': md('junk'),
    });
    const parsed = upload('flaky.zip', zip);
    expect(parsed.sourceFile).toBe('flaky-test-patterns/SKILL.md');
    expect(parsed.draft.name).toBe('flaky-test-patterns');
    expect(parsed.skipped).toEqual(
      expect.arrayContaining([
        { path: 'flaky-test-patterns/scripts/find-sleeps.sh', reason: 'script' },
        { path: 'flaky-test-patterns/references/extra.md', reason: 'extra_markdown' },
        { path: '__MACOSX/flaky-test-patterns/._SKILL.md', reason: 'os_metadata' },
      ]),
    );
    expect(parsed.warnings).toContainEqual({
      code: 'skipped_file_referenced',
      detail: 'flaky-test-patterns/scripts/find-sleeps.sh',
    });
  });

  it('the shipped docs/agent-skills/flaky-test-patterns folder imports cleanly, when present', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    const dir = new URL('../../docs/agent-skills/flaky-test-patterns/', import.meta.url);
    if (!existsSync(new URL('SKILL.md', dir))) return; // written by the seed/content change
    const zip = zipSync({
      'flaky-test-patterns/SKILL.md': readFileSync(new URL('SKILL.md', dir)),
      'flaky-test-patterns/scripts/find-sleeps.sh': readFileSync(new URL('scripts/find-sleeps.sh', dir)),
    });
    const parsed = upload('flaky-test-patterns.zip', zip);
    expect(parsed.draft.name).toBe('flaky-test-patterns');
    expect(parsed.skipped).toContainEqual({ path: 'flaky-test-patterns/scripts/find-sleeps.sh', reason: 'script' });
  });

  it('a .zip that is not a zip, or a corrupt one, is refused', () => {
    expect(() => upload('x.zip', md('# just markdown'))).toThrow(/not a zip/);
    const zip = zipSync({ 'SKILL.md': md('# x') });
    expect(() => upload('x.zip', zip.subarray(0, 20))).toThrow(/could not be read/);
  });

  it('refuses an archive with too many entries or too much declared content', () => {
    const many: Record<string, Uint8Array> = { 'SKILL.md': md('# x') };
    for (let i = 0; i < 120; i++) many[`f${i}.txt`] = md('x');
    expect(() => upload('many.zip', zipSync(many))).toThrow(/more than 100 entries/);

    const huge = zipSync({ 'SKILL.md': md('# x'), 'blob.txt': new Uint8Array(3 * 1024 * 1024) }, { level: 9 });
    expect(huge.length).toBeLessThan(512 * 1024);
    expect(() => upload('huge.zip', huge)).toThrow(/more than 2 MiB/);
  });

  it('a header that understates the core file size cannot make memory grow', () => {
    const big = md('# Rules\n' + 'A'.repeat(200_000));
    const zip = zipSync({ 'SKILL.md': big }, { level: 9 });
    // Claim 100 bytes in both the local header and the central directory.
    const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    dv.setUint32(22, 100, true);
    for (let i = 0; i < zip.length - 4; i++) {
      if (dv.getUint32(i, true) === 0x02014b50) {
        dv.setUint32(i + 24, 100, true);
        break;
      }
    }
    const parsed = upload('liar.zip', zip);
    expect(parsed.draft.body.length).toBeLessThanOrEqual(100);
  });

  it('refuses an archive whose SKILL.md is too big', () => {
    const zip = zipSync({ 'SKILL.md': md('# x\n' + 'b'.repeat(300 * 1024)) }, { level: 9 });
    expect(() => upload('big.zip', zip)).toThrow(/larger than 256 KiB/);
  });
});

describe('parseSkillUpload — preferHeadingName (URL import)', () => {
  const viaUrl = (filename: string, text: string) =>
    parseSkillUpload({ filename, bytes: md(text), preferHeadingName: true });

  it('names a skill without a frontmatter name after its first heading', () => {
    const parsed = viaUrl('raw.md', 'Ignore this line.\n\n# Malicious Skill\n\n## Rule\nx');
    expect(parsed.draft.name).toBe('malicious-skill');
    expect(parsed.warnings).toContainEqual({ code: 'name_derived', detail: 'from "Malicious Skill"' });
    // A folder name loses to the heading too; a heading in a code fence doesn't count.
    expect(viaUrl('flaky/SKILL.md', '```\n# Not this\n```\n# Flaky Tests\nx').draft.name).toBe('flaky-tests');
  });

  it('a frontmatter name still wins', () => {
    expect(viaUrl('raw.md', '---\nname: from-frontmatter\n---\n# Heading Name\nx').draft.name).toBe('from-frontmatter');
  });

  it('falls back as before when there is no usable heading', () => {
    expect(viaUrl('flaky/SKILL.md', 'No heading here.').draft.name).toBe('flaky');
    expect(viaUrl('edge-cases.md', '# !!!\nx').draft.name).toBe('edge-cases');
  });

  it('is off by default, so file import keeps naming by file', () => {
    expect(upload('edge-cases.md', md('# Something Else\nx')).draft.name).toBe('edge-cases');
    expect(parseSkillUpload({ filename: 'edge-cases.md', bytes: md('# Something Else\nx') }).draft.name).toBe('edge-cases');
  });

  it('applies to the core file of a zip too', () => {
    const zip = zipSync({ 'pack/SKILL.md': md('# Pack Rules\nx') });
    expect(parseSkillUpload({ filename: 'p.zip', bytes: zip, preferHeadingName: true }).draft.name).toBe('pack-rules');
    expect(parseSkillUpload({ filename: 'p.zip', bytes: zip }).draft.name).toBe('pack');
  });
});
