// Shared helpers for the pr-self-review scripts: git, the per-clone store, JSON
// files, globs and argument parsing. Dependency-free, Node >= 22.
//
// The store lives in `<git-common-dir>/pr-self-review/`, so every worktree of a
// clone shares verdicts, caches and waivers, and nothing in it is ever committed.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TOOL_VERSION = '1.2.0';
export const SEVERITIES = ['CRITICAL', 'WARNING', 'SUGGESTION'];
export const CATEGORIES = ['bug', 'security', 'perf', 'style', 'test'];
export const ZERO_SHA = /^0+$/;

const MAX_BUFFER = 512 * 1024 * 1024;

// ---------------------------------------------------------------- git

/** Run git and return stdout without the trailing newline; throws with stderr. */
export function git(args, { cwd = process.cwd(), env, input, trim = true } = {}) {
  const out = execFileSync('git', args, {
    cwd,
    env: env ?? process.env,
    input,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return trim ? out.replace(/\n$/, '') : out;
}

/** Like `git`, but returns `null` instead of throwing. */
export function gitTry(args, opts = {}) {
  try {
    return git(args, opts);
  } catch {
    return null;
  }
}

export function repoRoot(cwd = process.cwd()) {
  const root = gitTry(['rev-parse', '--show-toplevel'], { cwd });
  if (!root) fail('not inside a git work tree');
  return root;
}

export function commonDir(root) {
  const dir = git(['rev-parse', '--git-common-dir'], { cwd: root });
  return isAbsolute(dir) ? dir : resolve(root, dir);
}

export function storeDir(root) {
  return join(commonDir(root), 'pr-self-review');
}

export function runDir(root, runId) {
  return join(storeDir(root), 'runs', runId);
}

export function verdictPath(root, tree) {
  return join(storeDir(root), 'verdicts', `${tree}.json`);
}

export function revParse(root, ref) {
  return gitTry(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root });
}

export function currentBranch(root) {
  const name = gitTry(['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: root });
  return name || 'HEAD';
}

/** File name safe form of a branch, for per-branch store files. */
export function branchKey(branch) {
  return branch.replace(/[^A-Za-z0-9._-]+/g, '_');
}

/**
 * The tree of the working copy as `git add -A` would commit it. A clean tree is
 * `HEAD^{tree}`; a dirty one is written through a throwaway index (a copy of
 * the real one, for its stat cache), so the real index is never touched.
 */
export function worktreeTree(root) {
  const status = git(['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root });
  const head = revParse(root, 'HEAD');
  if (!head) fail('HEAD has no commit yet');
  if (status === '') return { tree: git(['rev-parse', 'HEAD^{tree}'], { cwd: root }), dirty: false, head };
  const tmp = join(tmpdir(), `pr-self-review-index-${randomBytes(6).toString('hex')}`);
  const realIndex = resolve(root, git(['rev-parse', '--git-path', 'index'], { cwd: root }));
  const env = { ...process.env, GIT_INDEX_FILE: tmp };
  try {
    if (existsSync(realIndex)) copyFileSync(realIndex, tmp);
    else git(['read-tree', 'HEAD'], { cwd: root, env });
    git(['add', '-A'], { cwd: root, env });
    return { tree: git(['write-tree'], { cwd: root, env }), dirty: true, head };
  } finally {
    rmSync(tmp, { force: true });
  }
}

/**
 * The ref a branch is compared with: an explicit `--base`, else the remote's
 * default branch (`<remote>/HEAD`), else `<remote>/main`. No local fallback:
 * comparing with a stale local main would review the wrong diff.
 */
export function resolveBaseRef(root, explicit, remote = 'origin') {
  if (explicit) {
    if (!revParse(root, explicit)) fail(`base ref "${explicit}" does not resolve to a commit`);
    return explicit;
  }
  const head = gitTry(['symbolic-ref', '-q', `refs/remotes/${remote}/HEAD`], { cwd: root });
  if (head && revParse(root, head)) return head.replace(/^refs\/remotes\//, '');
  if (revParse(root, `${remote}/main`)) return `${remote}/main`;
  fail(`can't tell what to compare with: no ${remote}/HEAD or ${remote}/main. Pass --base <ref>.`);
}

export function mergeBase(root, a, b) {
  return gitTry(['merge-base', a, b], { cwd: root });
}

export function isAncestor(root, a, b) {
  return spawnSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: root }).status === 0;
}

/**
 * File contents at a tree-ish, or null when the path doesn't exist there.
 * `cat-file blob`, not `git show`: for a missing path with glob characters
 * (`[number]/x.ts`) `git show` falls back to a pathspec and prints HEAD.
 */
export function showFile(root, treeish, path) {
  const key = `${treeish}:${path}`;
  if (blobCache.has(key)) return blobCache.get(key);
  const text = gitTry(['cat-file', 'blob', key], { cwd: root, trim: false });
  blobCache.set(key, text);
  return text;
}

const blobCache = new Map();

/** Read many `<treeish>:<path>` blobs with one `git cat-file --batch`; missing ones are null. */
export function readBlobs(root, names) {
  const todo = [...new Set(names)].filter((n) => !blobCache.has(n) && !n.includes('\n'));
  if (todo.length) {
    const out = execFileSync('git', ['cat-file', '--batch'], {
      cwd: root,
      input: `${todo.join('\n')}\n`,
      maxBuffer: MAX_BUFFER,
    });
    let pos = 0;
    for (const name of todo) {
      const nl = out.indexOf(0x0a, pos);
      const header = out.subarray(pos, nl).toString('utf8');
      pos = nl + 1;
      const m = /^[0-9a-f]+ (\w+) (\d+)$/.exec(header);
      if (!m) {
        blobCache.set(name, null);
        continue;
      }
      const size = Number(m[2]);
      blobCache.set(name, m[1] === 'blob' ? out.subarray(pos, pos + size).toString('utf8') : null);
      pos += size + 1;
    }
  }
  return new Map(names.map((n) => [n, blobCache.get(n) ?? null]));
}

// ---------------------------------------------------------------- files

export function readJson(path, fallback = undefined) {
  if (!existsSync(path)) {
    if (fallback !== undefined) return fallback;
    fail(`missing file: ${path}`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Write through a temp file + rename, so a reader never sees half a file. */
export function writeJsonAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, path);
}

export function writeTextAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

export function appendJsonl(path, rows) {
  if (rows.length === 0) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

export function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

// ---------------------------------------------------------------- globs

/**
 * Minimal glob → RegExp: `**` spans any number of directories (none included),
 * `*` and `?` stay inside one segment, `{a,b}` alternates. Everything else is
 * literal, so Next.js segments like `(shell)` and `[repoId]` match as written.
 */
export function globToRegExp(glob) {
  return new RegExp(`^${globSource(glob)}$`);
}

function globSource(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) {
        re += '\\{';
        continue;
      }
      re += `(?:${glob.slice(i + 1, end).split(',').map(globSource).join('|')})`;
      i = end;
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return re;
}

const globCache = new Map();
export function matchGlob(path, glob) {
  let re = globCache.get(glob);
  if (!re) globCache.set(glob, (re = globToRegExp(glob)));
  return re.test(path);
}

export function matchAny(path, globs = []) {
  return globs.some((g) => matchGlob(path, g));
}

// ---------------------------------------------------------------- ranges

/** Sorted, merged [start, end] ranges from a list of line numbers. */
export function toRanges(lines) {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const out = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else out.push([n, n]);
  }
  return out;
}

export function intersects(ranges, start, end) {
  return ranges.some(([s, e]) => start <= e && end >= s);
}

// ---------------------------------------------------------------- cli

/**
 * `--flag`, `--key value` and `--key=value`; repeated keys collect into arrays
 * when the spec says so. Positionals land in `_`.
 */
export function parseArgs(argv, { booleans = [], arrays = [] } = {}) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      out._.push(arg);
      continue;
    }
    let [key, value] = arg.slice(2).split(/=(.*)/s, 2);
    if (value === undefined) {
      if (booleans.includes(key)) value = true;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) value = argv[++i];
      else value = true;
    }
    if (arrays.includes(key)) (out[key] ??= []).push(value);
    else out[key] = value;
  }
  return out;
}

export function fail(message, code = 1) {
  process.stderr.write(`pr-self-review: ${message}\n`);
  process.exit(code);
}

export function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** True when this module is the script node was started with. */
export function isMain(importMetaUrl) {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(importMetaUrl);
}
