#!/usr/bin/env node
// What a self-review looks at: the base, the reviewed tree (its fingerprint),
// every changed file with its hunks and added lines, and the branch's commits.
//
//   node collect-diff.mjs [--base <ref>] [--json]
//
// The reviewed state is the working copy as `git add -A` would commit it, so
// committed, staged, unstaged and untracked (not ignored) changes all count.
// The diff is taken with `-a`: without it git calls a source file with a NUL
// byte (server/src/adapters/depgraph/index.ts) binary and drops its hunks.

import {
  fail,
  git,
  isMain,
  mergeBase,
  parseArgs,
  repoRoot,
  resolveBaseRef,
  revParse,
  toRanges,
  matchAny,
  worktreeTree,
  currentBranch,
} from './lib.mjs';

const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|ico|bmp|tiff?|avif|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|bz2|xz|7z|jar|wasm|mp[34]|mov|webm|ogg|wav|sqlite|db|bin|exe|dll|so|dylib|node)$/i;
const MAX_TEXT_BYTES = 1_000_000;

/** Generated files: checked deterministically, never sent to a reviewer. */
export const GENERATED = [
  '**/pnpm-lock.yaml',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/npm-shrinkwrap.json',
  'server/src/db/migrations/meta/**',
  '**/next-env.d.ts',
  '**/*.tsbuildinfo',
];

/** Never reviewed at all; still listed, so the do-not-touch check sees them. */
export const EXCLUDED = ['server/clones/**', '**/node_modules/**'];

/**
 * @param root     repo root
 * @param opts.base     explicit base ref (else `<remote>/HEAD`, then `<remote>/main`)
 * @param opts.commit   review this commit's tree instead of the working copy (the gate)
 * @param opts.remote   remote whose default branch is the base (default origin)
 */
export function collectDiff(root, { base, commit, remote = 'origin' } = {}) {
  const baseRef = resolveBaseRef(root, base, remote);
  let tree, dirty, head;
  if (commit) {
    head = revParse(root, commit);
    if (!head) fail(`not a commit: ${commit}`);
    tree = git(['rev-parse', `${head}^{tree}`], { cwd: root });
    dirty = false;
  } else {
    ({ tree, dirty, head } = worktreeTree(root));
  }
  const baseSha = mergeBase(root, baseRef, head);
  if (!baseSha) fail(`${baseRef} and ${head.slice(0, 12)} share no history`);

  const text = git(
    [
      '-c', 'core.quotepath=false',
      'diff', '-a', '--no-ext-diff', '--no-textconv', '--no-color', '-M', '--full-index',
      '--src-prefix=a/', '--dst-prefix=b/',
      baseSha, tree,
    ],
    { cwd: root, trim: false },
  );
  const sizes = treeSizes(root, tree);
  const blobs = treeBlobs(root, baseSha);
  const files = parseDiff(text).map((f) => finishFile(f, sizes, blobs));

  return {
    base_ref: baseRef,
    base_sha: baseSha,
    head_sha: head,
    tree,
    dirty,
    branch: commit ? null : currentBranch(root),
    files,
    commits: listCommits(root, baseSha, head),
    stats: {
      files: files.length,
      added: files.reduce((n, f) => n + f.added_count, 0),
      removed: files.reduce((n, f) => n + f.removed_count, 0),
    },
  };
}

/** Split `git diff` output into per-file records with hunks and added lines. */
export function parseDiff(text) {
  const files = [];
  let cur = null;
  let inHunk = false;
  let oldLn = 0;
  let newLn = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      cur = {
        header: line,
        path: null,
        old_path: null,
        status: 'M',
        similarity: null,
        binary_marker: false,
        hunks: [],
        addedLines: [],
        removedOld: [],
        added_text: [],
        context: [],
        patchLines: [line],
      };
      files.push(cur);
      inHunk = false;
      continue;
    }
    if (!cur) continue;
    cur.patchLines.push(line);
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      inHunk = true;
      oldLn = Number(hunk[1]);
      newLn = Number(hunk[3]);
      cur.hunks.push({
        old_start: oldLn,
        old_lines: hunk[2] === undefined ? 1 : Number(hunk[2]),
        new_start: newLn,
        new_lines: hunk[4] === undefined ? 1 : Number(hunk[4]),
      });
      continue;
    }
    if (inHunk) {
      if (line.startsWith('+')) {
        cur.addedLines.push(newLn);
        cur.added_text.push([newLn, line.slice(1)]);
        newLn++;
      } else if (line.startsWith('-')) {
        cur.removedOld.push(oldLn);
        oldLn++;
      } else if (line.startsWith(' ')) {
        cur.context.push([oldLn, newLn]);
        oldLn++;
        newLn++;
      }
      continue;
    }
    if (line.startsWith('new file mode')) cur.status = 'A';
    else if (line.startsWith('deleted file mode')) cur.status = 'D';
    else if (line.startsWith('rename from ')) {
      cur.status = 'R';
      cur.old_path = unquote(line.slice('rename from '.length));
    } else if (line.startsWith('rename to ')) cur.path = unquote(line.slice('rename to '.length));
    else if (line.startsWith('copy from ')) {
      cur.status = 'C';
      cur.old_path = unquote(line.slice('copy from '.length));
    } else if (line.startsWith('copy to ')) cur.path = unquote(line.slice('copy to '.length));
    else if (line.startsWith('similarity index ')) cur.similarity = parseInt(line.slice(17), 10);
    else if (line.startsWith('--- ')) {
      const p = unquote(line.slice(4));
      if (p !== '/dev/null') cur.old_path ??= p.replace(/^a\//, '');
    } else if (line.startsWith('+++ ')) {
      const p = unquote(line.slice(4));
      if (p !== '/dev/null') cur.path = p.replace(/^b\//, '');
    } else if (line.startsWith('Binary files ')) cur.binary_marker = true;
  }
  for (const f of files) {
    if (!f.path) f.path = f.old_path ?? pathFromHeader(f.header);
    if (f.status === 'D') f.path = f.old_path ?? f.path;
    if (!f.old_path && f.status !== 'A') f.old_path = f.path;
  }
  return files;
}

function finishFile(f, sizes, baseBlobs) {
  const size = sizes.get(f.path);
  const binary = f.binary_marker || BINARY_EXT.test(f.path) || (size?.bytes ?? 0) > MAX_TEXT_BYTES;
  const patch = f.patchLines.join('\n').replace(/\n+$/, '');
  return {
    path: f.path,
    old_path: f.status === 'A' ? null : f.old_path,
    status: f.status,
    similarity: f.similarity,
    pure_rename: f.status === 'R' && f.hunks.length === 0,
    old_blob: f.status === 'A' ? null : (baseBlobs.get(f.old_path) ?? null),
    new_blob: f.status === 'D' ? null : (size?.blob ?? null),
    binary,
    generated: matchAny(f.path, GENERATED),
    excluded: matchAny(f.path, EXCLUDED),
    hunks: f.hunks,
    added: toRanges(f.addedLines),
    added_count: f.addedLines.length,
    removed_count: f.removedOld.length,
    removed_old: toRanges(f.removedOld),
    added_text: binary ? [] : f.added_text,
    context: binary ? [] : f.context,
    patch: binary ? `${f.patchLines[0]}\n(binary or oversized file — not shown)` : patch,
    patch_lines: binary ? 0 : f.patchLines.length,
  };
}

function treeSizes(root, tree) {
  const map = new Map();
  const out = git(['ls-tree', '-r', '-l', '-z', tree], { cwd: root, trim: false });
  for (const entry of out.split('\0')) {
    const m = /^\d+ blob ([0-9a-f]+) +(\d+|-)\t(.*)$/s.exec(entry);
    if (m) map.set(m[3], { blob: m[1], bytes: m[2] === '-' ? 0 : Number(m[2]) });
  }
  return map;
}

function treeBlobs(root, commit) {
  const map = new Map();
  const out = git(['ls-tree', '-r', '-z', commit], { cwd: root, trim: false });
  for (const entry of out.split('\0')) {
    const m = /^\d+ blob ([0-9a-f]+)\t(.*)$/s.exec(entry);
    if (m) map.set(m[2], m[1]);
  }
  return map;
}

function listCommits(root, base, head) {
  if (base === head) return [];
  const out = git(['log', '--format=%H%x1f%P%x1f%s%x1f%b%x1e', `${base}..${head}`], { cwd: root, trim: false });
  return out
    .split('\x1e')
    .map((r) => r.replace(/^\n/, ''))
    .filter(Boolean)
    .map((r) => {
      const [sha, parents, subject, body] = r.split('\x1f');
      return { sha, subject, body: (body ?? '').trim(), merge: parents.trim().split(' ').length > 1 };
    });
}

/** `diff --git a/P b/P` with no ---/+++ lines (an empty new file, a mode change). */
function pathFromHeader(header) {
  const rest = header.slice('diff --git a/'.length);
  return rest.slice(0, (rest.length - 3) / 2);
}

function unquote(p) {
  if (!p.startsWith('"')) return p;
  try {
    return JSON.parse(p);
  } catch {
    return p.slice(1, -1);
  }
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2), { booleans: ['json'] });
  const root = repoRoot();
  const diff = collectDiff(root, { base: args.base });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(diff, null, 2)}\n`);
  } else {
    const { stats } = diff;
    console.log(
      `base ${diff.base_ref} @ ${diff.base_sha.slice(0, 12)} · tree ${diff.tree.slice(0, 12)}${diff.dirty ? ' (uncommitted changes included)' : ''}`,
    );
    console.log(`${stats.files} files · +${stats.added} −${stats.removed} · ${diff.commits.length} commits`);
    for (const f of diff.files) {
      const flags = [f.binary && 'binary', f.generated && 'generated', f.excluded && 'excluded', f.pure_rename && 'rename only']
        .filter(Boolean)
        .join(', ');
      const from = f.status === 'R' ? ` (from ${f.old_path})` : '';
      console.log(`  ${f.status} ${f.path}${from} +${f.added_count} −${f.removed_count}${flags ? ` [${flags}]` : ''}`);
    }
  }
}
