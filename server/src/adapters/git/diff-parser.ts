import type { UnifiedDiff, DiffHunk } from '@devdigest/shared';

type DiffFile = UnifiedDiff['files'][number];

/**
 * Unified-diff parser. Extracts per-file hunks and the set of new-side line
 * numbers each hunk covers — exactly what the citation-grounding gate needs
 * (file:line must intersect a real hunk).
 *
 * A small state machine over `git diff` output:
 *   header  `diff --git a/path b/path`, then metadata (`new file mode`,
 *           `rename from/to`, `index …`, `Binary files …`) and `--- a/path` /
 *           `+++ b/path` — recognised ONLY here, so a removed line that starts
 *           with `-- ` or an added one with `++ ` stays content;
 *   hunk    `@@ -oldStart,oldLines +newStart,newLines @@`, then exactly that
 *           many old/new lines (`\ No newline at end of file` counts as
 *           neither); a line that can't be hunk content ends the hunk early,
 *           so truncated hunks (hand-written fixtures, GitHub patches) parse.
 *
 * Paths: `/dev/null` sides (new / deleted files), renames (the new path wins),
 * C-quoted paths (`"b/sp\"ace.ts"`, `\ooo` escapes) and the trailing tab git
 * adds after a path with spaces. A deleted file is left out: nothing on the new
 * side exists to cite, so a finding on it must not ground (grounding would
 * otherwise treat its `+0,0` hunk as covering line 0). Prefixes are assumed to
 * be `a/` and `b/` — the git adapter forces them (`--src-prefix/--dst-prefix`).
 */
export function parseUnifiedDiff(raw: string): UnifiedDiff {
  const files: DiffFile[] = [];
  const lines = raw.split('\n');

  // Declared through assertions: the closures below reassign them, which
  // control-flow narrowing can't see (it would keep them typed as `null`).
  let file = null as DiffFile | null;
  let oldPath = null as string | null;
  let newPath = null as string | null;
  let hunk = null as DiffHunk | null;
  let deleted = false;
  let oldLeft = 0;
  let newLeft = 0;
  let newNo = 0;

  const endHunk = () => {
    if (file && hunk) file.hunks.push(hunk);
    hunk = null;
    oldLeft = 0;
    newLeft = 0;
  };
  const endFile = () => {
    endHunk();
    if (file && !deleted) {
      file.path = newPath ?? oldPath ?? file.path;
      if (file.path) {
        for (const h of file.hunks) h.file = file.path;
        files.push(file);
      }
    }
    file = null;
    oldPath = null;
    newPath = null;
    deleted = false;
  };
  const startFile = (headerPath = '') => {
    endFile();
    file = { path: headerPath, additions: 0, deletions: 0, hunks: [] };
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // ---- inside a hunk: content until its declared line counts are used up
    if (hunk && (oldLeft > 0 || newLeft > 0)) {
      const kind = line[0];
      const last = i === lines.length - 1;
      if (kind === '+' && newLeft > 0) {
        file!.additions++;
        hunk.newLineNumbers.push(newNo++);
        newLeft--;
        continue;
      }
      if (kind === '-' && oldLeft > 0) {
        file!.deletions++;
        oldLeft--;
        continue;
      }
      if ((kind === ' ' || (line === '' && !last)) && oldLeft > 0 && newLeft > 0) {
        // Context (an empty line is context whose leading space was stripped).
        hunk.newLineNumbers.push(newNo++);
        oldLeft--;
        newLeft--;
        continue;
      }
      if (kind === '\\') continue; // "\ No newline at end of file"
      // Anything else: the hunk was shorter than its header — close it and
      // read this line as a header.
      endHunk();
    }

    if (line.startsWith('\\')) continue; // marker right after a hunk's last line

    if (line.startsWith('diff --git ')) {
      startFile(pathFromGitHeader(line.slice('diff --git '.length)));
      continue;
    }

    const hh = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hh) {
      if (!file) startFile();
      endHunk();
      const newStart = Number(hh[3]);
      hunk = {
        file: '',
        oldStart: Number(hh[1]),
        oldLines: hh[2] !== undefined ? Number(hh[2]) : 1,
        newStart,
        newLines: hh[4] !== undefined ? Number(hh[4]) : 1,
        newLineNumbers: [],
      };
      oldLeft = hunk.oldLines;
      newLeft = hunk.newLines;
      newNo = newStart;
      continue;
    }

    if (line.startsWith('--- ')) {
      // A plain unified diff (no `diff --git` line) starts its file here.
      if (!file || file.hunks.length > 0 || hunk) startFile();
      oldPath = sidePath(line.slice(4), 'a/') ?? oldPath;
      continue;
    }
    if (line.startsWith('+++ ')) {
      if (!file) startFile();
      const p = sidePath(line.slice(4), 'b/');
      if (p === null) deleted = true; // `+++ /dev/null`
      else newPath = p;
      continue;
    }
    if (!file) continue;
    if (line.startsWith('deleted file mode ')) deleted = true;
    else if (line.startsWith('rename from ')) oldPath = unquote(line.slice('rename from '.length));
    else if (line.startsWith('rename to ')) newPath = unquote(line.slice('rename to '.length));
  }
  endFile();

  return { raw, files };
}

/**
 * A `---`/`+++` side: the path without its prefix, or null for `/dev/null`
 * (the file doesn't exist on that side). Git appends a tab after a path that
 * contains spaces.
 */
function sidePath(spec: string, prefix: 'a/' | 'b/'): string | null {
  const p = unquote(spec.replace(/\t.*$/, '').trimEnd());
  if (p === '/dev/null') return null;
  return p.startsWith(prefix) ? p.slice(prefix.length) : p;
}

/**
 * The path in `a/X b/X` (quoted or not). Only a fallback — `---`/`+++` or
 * `rename to` give the path when present; a binary or mode-only change has
 * neither. Unquoted, the split is ambiguous when X contains " b/", so it takes
 * the length that makes both halves equal (true unless the file was renamed).
 */
function pathFromGitHeader(rest: string): string {
  if (rest.startsWith('"')) {
    const m = rest.match(/^"(?:[^"\\]|\\.)*"\s+(.+)$/);
    const b = m ? unquote(m[1]!) : '';
    return b.startsWith('b/') ? b.slice(2) : b;
  }
  if (rest.startsWith('a/') && (rest.length - 5) % 2 === 0) {
    const half = (rest.length - 5) / 2;
    const a = rest.slice(2, 2 + half);
    const b = rest.slice(2 + half + 3);
    if (rest.slice(2 + half, 2 + half + 3) === ' b/' && a === b) return b;
  }
  const idx = rest.lastIndexOf(' b/');
  return idx >= 0 ? rest.slice(idx + 3) : '';
}

/** Undo git's C-style quoting: `"a/sp\"ace\303\251.ts"` → `a/sp"aceé.ts`. */
function unquote(s: string): string {
  if (!(s.length >= 2 && s.startsWith('"') && s.endsWith('"'))) return s;
  const body = s.slice(1, -1);
  const bytes: number[] = [];
  const escapes: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, '\\': 92, a: 7, b: 8, f: 12, v: 11 };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf8'));
      continue;
    }
    const next = body[i + 1] ?? '';
    const octal = body.slice(i + 1, i + 4);
    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(parseInt(octal, 8));
      i += 3;
    } else {
      bytes.push(escapes[next] ?? next.charCodeAt(0));
      i += 1;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}
