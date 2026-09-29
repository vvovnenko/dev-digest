/**
 * parseUnifiedDiff — the new-side lines each hunk covers are what citation
 * grounding checks findings against, so a line counted wrongly either drops a
 * real finding or keeps a hallucinated one.
 */
import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';

const lines = (...l: string[]) => l.join('\n') + '\n';

type Expected = { path: string; additions: number; deletions: number; covered: number[][] }[];

const CASES: { name: string; raw: string; files: Expected }[] = [
  {
    name: 'a modification: context + added lines are covered, removed ones are not',
    raw: lines(
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1111111..2222222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -10,3 +10,3 @@',
      ' keep',
      '-old',
      '+new',
      ' keep',
    ),
    files: [{ path: 'src/a.ts', additions: 1, deletions: 1, covered: [[10, 11, 12]] }],
  },
  {
    name: 'several hunks and files',
    raw: lines(
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,1 +1,2 @@',
      ' one',
      '+two',
      '@@ -20 +21,2 @@',
      ' twenty',
      '+twenty-one',
      'diff --git a/b.ts b/b.ts',
      '--- a/b.ts',
      '+++ b/b.ts',
      '@@ -5,2 +5 @@',
      ' five',
      '-six',
    ),
    files: [
      { path: 'a.ts', additions: 2, deletions: 0, covered: [[1, 2], [21, 22]] },
      { path: 'b.ts', additions: 0, deletions: 1, covered: [[5]] },
    ],
  },
  {
    name: '"\\ No newline at end of file" is not a line of the file',
    raw: lines(
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,2 +1,2 @@',
      ' one',
      '-two',
      '\\ No newline at end of file',
      '+two;',
      '\\ No newline at end of file',
    ),
    files: [{ path: 'a.ts', additions: 1, deletions: 1, covered: [[1, 2]] }],
  },
  {
    name: 'content lines that look like headers ("-- ", "++ ", "--- ", "+++") stay content',
    raw: lines(
      'diff --git a/q.sql b/q.sql',
      '--- a/q.sql',
      '+++ b/q.sql',
      '@@ -1,3 +1,3 @@',
      '--- a comment removed',
      '+++ counter',
      ' select 1;',
      '--- trailing',
      '+-- sql comment',
    ),
    files: [{ path: 'q.sql', additions: 2, deletions: 2, covered: [[1, 2, 3]] }],
  },
  {
    name: 'a quoted path with spaces and escapes (git adds a tab after spaced paths)',
    raw: lines(
      'diff --git "a/docs/sp ace\\"q\\303\\251.md" "b/docs/sp ace\\"q\\303\\251.md"',
      '--- "a/docs/sp ace\\"q\\303\\251.md"\t',
      '+++ "b/docs/sp ace\\"q\\303\\251.md"\t',
      '@@ -1 +1,2 @@',
      ' title',
      '+body',
    ),
    files: [{ path: 'docs/sp ace"qé.md', additions: 1, deletions: 0, covered: [[1, 2]] }],
  },
  {
    name: 'an unquoted path with spaces',
    raw: lines(
      'diff --git a/my notes.md b/my notes.md',
      '--- a/my notes.md\t',
      '+++ b/my notes.md\t',
      '@@ -1 +1 @@',
      '-x',
      '+y',
    ),
    files: [{ path: 'my notes.md', additions: 1, deletions: 1, covered: [[1]] }],
  },
  {
    name: 'a new file',
    raw: lines(
      'diff --git a/new.ts b/new.ts',
      'new file mode 100644',
      'index 0000000..3333333',
      '--- /dev/null',
      '+++ b/new.ts',
      '@@ -0,0 +1,2 @@',
      '+a',
      '+b',
    ),
    files: [{ path: 'new.ts', additions: 2, deletions: 0, covered: [[1, 2]] }],
  },
  {
    name: 'a deleted file is left out (nothing to cite on the new side), the next file still parses',
    raw: lines(
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-a',
      '-b',
      'diff --git a/kept.ts b/kept.ts',
      '--- a/kept.ts',
      '+++ b/kept.ts',
      '@@ -1 +1 @@',
      '-x',
      '+y',
    ),
    files: [{ path: 'kept.ts', additions: 1, deletions: 1, covered: [[1]] }],
  },
  {
    name: 'a rename with changes takes the new path',
    raw: lines(
      'diff --git a/old/name.ts b/new/name.ts',
      'similarity index 90%',
      'rename from old/name.ts',
      'rename to new/name.ts',
      '--- a/old/name.ts',
      '+++ b/new/name.ts',
      '@@ -3 +3 @@',
      '-x',
      '+y',
    ),
    files: [{ path: 'new/name.ts', additions: 1, deletions: 1, covered: [[3]] }],
  },
  {
    name: 'a pure rename (no hunks) and a binary file are listed without hunks',
    raw: lines(
      'diff --git a/a/x.ts b/b/x.ts',
      'similarity index 100%',
      'rename from a/x.ts',
      'rename to b/x.ts',
      'diff --git a/img.png b/img.png',
      'index 1111111..2222222 100644',
      'Binary files a/img.png and b/img.png differ',
    ),
    files: [
      { path: 'b/x.ts', additions: 0, deletions: 0, covered: [] },
      { path: 'img.png', additions: 0, deletions: 0, covered: [] },
    ],
  },
  {
    name: 'a hunk shorter than its header (hand-written fixture) ends at the next header',
    raw: [
      'diff --git a/src/config.ts b/src/config.ts',
      '--- a/src/config.ts',
      '+++ b/src/config.ts',
      '@@ -10,3 +10,4 @@',
      '   port: 3000,',
      '+  stripeKey: "sk_live_xxx",',
      '   redisUrl: x,',
      'diff --git a/b.ts b/b.ts',
      '--- a/b.ts',
      '+++ b/b.ts',
      '@@ -1 +1,2 @@',
      ' a',
      '+b',
    ].join('\n'),
    files: [
      { path: 'src/config.ts', additions: 1, deletions: 0, covered: [[10, 11, 12]] },
      { path: 'b.ts', additions: 1, deletions: 0, covered: [[1, 2]] },
    ],
  },
  {
    name: 'a plain unified diff without "diff --git" lines',
    raw: lines('--- a/a.ts', '+++ b/a.ts', '@@ -1 +1,2 @@', ' a', '+b', '--- a/b.ts', '+++ b/b.ts', '@@ -1 +1 @@', '-x', '+y'),
    files: [
      { path: 'a.ts', additions: 1, deletions: 0, covered: [[1, 2]] },
      { path: 'b.ts', additions: 1, deletions: 1, covered: [[1]] },
    ],
  },
  { name: 'an empty diff', raw: '', files: [] },
];

describe('parseUnifiedDiff', () => {
  it.each(CASES)('$name', ({ raw, files }) => {
    const diff = parseUnifiedDiff(raw);
    expect(diff.raw).toBe(raw);
    expect(
      diff.files.map((f) => ({
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
        covered: f.hunks.map((h) => h.newLineNumbers),
      })),
    ).toEqual(files);
    for (const f of diff.files) for (const h of f.hunks) expect(h.file).toBe(f.path);
  });
});
