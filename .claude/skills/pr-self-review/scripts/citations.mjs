#!/usr/bin/env node
// D9 — `path:line` citations in docs that the diff made stale.
//
//   node citations.mjs --run <run-id> [--fix]
//
// Docs cite code as `server/src/app.ts:207-258`. When the diff deletes, renames
// or shifts the cited lines, the citation points at the wrong code. This finds
// such citations in docs, specs, READMEs, TESTING.md, CLAUDE.md and skill
// references, maps old line numbers to new ones through the diff's hunks, and
// with --fix rewrites shifted or renamed full-path citations in place.
//
// Never touched: INSIGHTS.md (append-only; its citations are history) and
// CLAUDE.md (add-only — reported, never rewritten). Bare `:N` shorthand that
// leans on an earlier citation isn't matched at all: its file is whatever the
// writer had in mind, so it is checked by hand.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { git, isMain, matchAny, parseArgs, readBlobs, readJson, repoRoot, runDir, showFile } from './lib.mjs';

const DOC_GLOBS = [
  '**/docs/**/*.md',
  '**/specs/**/*.md',
  'README.md',
  '*/README.md',
  'TESTING.md',
  '**/CLAUDE.md',
  '.claude/skills/**/references/**/*.md',
];
const DOC_EXCLUDE = ['**/INSIGHTS.md', 'server/clones/**', '**/node_modules/**', '**/src/vendor/**'];

const CITATION =
  /(?<![\w/.@-])((?:\.\.\/)*(?:[\w@()[\].-]+\/)*[\w@()[\].-]+\.(?:ts|tsx|mts|mjs|cjs|js|json|ya?ml|md|sql|sh|css)):(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)/g;

/** Where an old line of a changed file is now: same/shifted number, or changed. */
export function mapOldLine(file, line) {
  if (file.removed_old.some(([s, e]) => line >= s && line <= e)) return { kind: 'changed' };
  const ctx = file.context.find(([o]) => o === line);
  if (ctx) return { kind: ctx[1] === line ? 'same' : 'shifted', line: ctx[1] };
  let offset = 0;
  for (const h of file.hunks) {
    if (h.old_start + h.old_lines <= line) offset += h.new_lines - h.old_lines;
  }
  return { kind: offset === 0 ? 'same' : 'shifted', line: line + offset };
}

function parseRanges(spec) {
  return spec.split(',').map((part) => {
    const [a, b] = part.split('-').map(Number);
    return [a, b ?? a];
  });
}

function formatRanges(ranges) {
  return ranges.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(',');
}

/** Resolve a cited path to repo-relative candidates: as written, package-relative, doc-relative. */
function candidates(doc, cited) {
  const out = new Set();
  if (!cited.startsWith('../')) out.add(cited);
  const pkg = doc.split('/')[0];
  if (['client', 'server', 'reviewer-core', 'e2e'].includes(pkg) && !cited.startsWith('../')) out.add(`${pkg}/${cited}`);
  const rel = posix.normalize(posix.join(posix.dirname(doc), cited));
  if (!rel.startsWith('..')) out.add(rel);
  return [...out];
}

export function checkCitations(root, diff) {
  const changedByOld = new Map();
  const changedByNew = new Map();
  for (const f of diff.files) {
    if (f.binary || f.excluded) continue;
    if (f.old_path) changedByOld.set(f.old_path, f);
    if (f.status !== 'D') changedByNew.set(f.path, f);
  }
  const treePaths = git(['ls-tree', '-r', '--name-only', diff.tree], { cwd: root }).split('\n');
  const inTree = new Set(treePaths);
  const docs = treePaths.filter((p) => matchAny(p, DOC_GLOBS) && !matchAny(p, DOC_EXCLUDE));
  readBlobs(root, docs.map((d) => `${diff.tree}:${d}`));
  const docChanges = new Map(diff.files.map((f) => [f.path, f]));
  const lineCount = new Map();
  const countLines = (path) => {
    if (!inTree.has(path)) return null;
    if (!lineCount.has(path)) {
      const text = showFile(root, diff.tree, path);
      lineCount.set(path, text === null ? null : text.replace(/\n$/, '').split('\n').length);
    }
    return lineCount.get(path);
  };

  const findings = [];
  for (const doc of docs) {
    const text = showFile(root, diff.tree, doc);
    if (!text) continue;
    const docFile = docChanges.get(doc);
    const addedDocLines = new Set((docFile?.added_text ?? []).map(([n]) => n));
    const lines = text.split('\n');
    const fixable = !/(^|\/)CLAUDE\.md$/.test(doc);
    lines.forEach((lineText, i) => {
      const docLine = i + 1;
      for (const m of lineText.matchAll(CITATION)) {
        const [whole, cited, spec] = m;
        const ranges = parseRanges(spec);
        if (addedDocLines.has(docLine)) {
          // Written against the new code: only check it points at a real line.
          const target = candidates(doc, cited).find((c) => countLines(c) !== null);
          if (!target) continue;
          const max = countLines(target);
          const bad = ranges.filter(([, b]) => b > max);
          if (bad.length) {
            findings.push(make('docs/citation-out-of-range', doc, docLine, `\`${whole}\` points past the end of ${target} (${max} lines)`, null));
          }
          continue;
        }
        const target = candidates(doc, cited).find((c) => changedByOld.has(c));
        if (!target) continue;
        const file = changedByOld.get(target);
        if (file.status === 'D') {
          findings.push(make('docs/cites-deleted-file', doc, docLine, `\`${whole}\` cites a file this diff deletes`, null));
          continue;
        }
        const mapped = ranges.map(([a, b]) => [mapOldLine(file, a), mapOldLine(file, b), a, b]);
        const newRanges = mapped.map(([x, y, a, b]) => [x.line ?? a, y.line ?? b]);
        const changed =
          mapped.some(([x, y]) => x.kind === 'changed' || y.kind === 'changed') ||
          file.removed_old.some(([s, e]) => ranges.some(([a, b]) => s <= b && e >= a)) ||
          file.added.some(([s, e]) => newRanges.some(([a, b]) => s <= b && e >= a));
        const renamed = file.status === 'R' && file.path !== file.old_path;
        const shifted = !changed && newRanges.some(([a, b], k) => a !== ranges[k][0] || b !== ranges[k][1]);
        if (changed) {
          findings.push(
            make(
              'docs/cited-lines-changed',
              doc,
              docLine,
              `\`${whole}\`: the diff changes the cited lines of ${target} — re-read the claim and fix the citation by hand`,
              null,
            ),
          );
          continue;
        }
        if (!shifted && !renamed) continue;
        const newPath = renamed ? cited.replace(new RegExp(`${escape(posix.basename(file.old_path))}$`), posix.basename(file.path)) : cited;
        const pathOk = !renamed || posix.dirname(file.old_path) === posix.dirname(file.path);
        const replacement = pathOk ? `${newPath}:${formatRanges(newRanges)}` : null;
        findings.push(
          make(
            renamed ? 'docs/cites-renamed-file' : 'docs/citation-shifted',
            doc,
            docLine,
            renamed
              ? `\`${whole}\` cites ${target}, now ${file.path}${replacement ? ` → \`${replacement}\`` : ' (moved to another folder: fix by hand)'}`
              : `\`${whole}\` is stale → \`${replacement}\``,
            fixable && replacement ? { find: whole, replace: replacement } : null,
          ),
        );
      }
    });
  }
  return findings;
}

function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function make(rule, doc, line, title, fix) {
  return {
    source: 'check',
    check: 'D9',
    rule_id: rule,
    severity: 'WARNING',
    category: 'style',
    title,
    file: doc,
    start_line: line,
    end_line: line,
    rationale:
      'A stale `path:line` sends the next reader to the wrong code. Docs and specs are fixed in place; CLAUDE.md is add-only, so fix it there only with the user\'s OK.',
    suggestion: fix ? `Replace \`${fix.find}\` with \`${fix.replace}\` (\`/pr-self-review --fix\` does it).` : null,
    confidence: 1,
    waivable: true,
    fix,
  };
}

/** Rewrite the fixable citations in the working copy. Returns the edits made. */
export function applyCitationFixes(root, findings) {
  const edits = [];
  const byDoc = new Map();
  for (const f of findings) if (f.fix) (byDoc.get(f.file) ?? byDoc.set(f.file, []).get(f.file)).push(f);
  for (const [doc, list] of byDoc) {
    const path = join(root, doc);
    const lines = readFileSync(path, 'utf8').split('\n');
    for (const f of list) {
      const i = f.start_line - 1;
      if (lines[i]?.includes(f.fix.find)) {
        lines[i] = lines[i].replace(f.fix.find, f.fix.replace);
        edits.push(`${doc}:${f.start_line} ${f.fix.find} → ${f.fix.replace}`);
      }
    }
    writeFileSync(path, lines.join('\n'));
  }
  return edits;
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2), { booleans: ['fix'] });
  const root = repoRoot();
  if (!args.run) {
    process.stderr.write('usage: citations.mjs --run <run-id> [--fix]\n');
    process.exit(2);
  }
  const diff = readJson(join(runDir(root, args.run), 'diff.json'));
  const findings = checkCitations(root, diff);
  for (const f of findings) console.log(`${f.file}:${f.start_line} ${f.rule_id} — ${f.title}`);
  if (!findings.length) console.log('no stale citations');
  if (args.fix) {
    const edits = applyCitationFixes(root, findings);
    console.log(edits.length ? `fixed ${edits.length}:\n  ${edits.join('\n  ')}` : 'nothing to fix automatically');
  }
}
