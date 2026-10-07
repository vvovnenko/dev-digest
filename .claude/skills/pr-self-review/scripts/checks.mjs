#!/usr/bin/env node
// Deterministic checks D1–D11 over a self-review run (no model involved).
//
//   node checks.mjs --run <run-id> [--quick | --full]
//   node checks.mjs --ci [--base <ref>]       CI: HEAD vs base, exit 1 on a blocking CRITICAL
//
// D1 secrets · D2 do-not-touch · D3 migrations · D4 contracts · D5 INSIGHTS
// append-only · D6 architecture (pnpm arch, baseline, ratchets) · D7 typecheck
// (+ unit tests with --full) · D8 spec "Unchanged" zones · D9 stale citations ·
// D10 logic without tests · D11 commit hygiene · S* small rules · INSIGHTS reminder.
//
// Each check reports pass / warn / fail / error / skip and its findings. A
// CRITICAL from D1, D4, D5, D6 or D7 can't be waived: CI fails anyway, or a key
// already leaked. `error` means a check could not run (no node_modules, …): the
// verdict is then INCOMPLETE, never PASS. In --ci mode, waivable and
// to-be-verified CRITICALs only warn: the local gate is where they are decided.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { checkCitations } from './citations.mjs';
import { collectDiff } from './collect-diff.mjs';
import {
  git,
  isMain,
  matchAny,
  parseArgs,
  readJson,
  repoRoot,
  runDir,
  sha256,
  showFile,
  writeJsonAtomic,
} from './lib.mjs';
import { inZone, linkSpecs, unchangedZone } from './specs.mjs';

const LOCKFILES = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'npm-shrinkwrap.json', 'bun.lockb'];

// ---------------------------------------------------------------- findings

function finding(check, rule_id, severity, file, start, end, title, rationale, opts = {}) {
  const f = {
    source: 'check',
    check,
    rule_id,
    severity,
    category: opts.category ?? (rule_id.startsWith('secret/') ? 'security' : 'bug'),
    title,
    file,
    start_line: start ?? null,
    end_line: end ?? start ?? null,
    rationale,
    suggestion: opts.suggestion ?? null,
    confidence: 1,
    waivable: opts.waivable ?? false,
    needs_verification: opts.needs_verification ?? false,
  };
  f.id = `c-${sha256([rule_id, file, start, title].join('|')).slice(0, 10)}`;
  return f;
}

const result = (id, title, findings = [], extra = {}) => ({
  id,
  title,
  status: extra.status ?? (findings.some((f) => f.severity === 'CRITICAL') ? 'fail' : findings.length ? 'warn' : 'pass'),
  findings,
  notes: extra.notes ?? [],
  ms: extra.ms ?? 0,
});

const live = (diff) => diff.files.filter((f) => !f.excluded);
const textOf = (root, diff, path) => showFile(root, diff.tree, path);
const baseTextOf = (root, diff, path) => (path ? showFile(root, diff.base_sha, path) : null);

// ---------------------------------------------------------------- D1 secrets

const SECRET_PATTERNS = [
  ['secret/github-token', /\b(gh[pousr]_[A-Za-z0-9]{36,})\b/],
  ['secret/github-pat', /\b(github_pat_[A-Za-z0-9_]{50,})\b/],
  ['secret/openrouter-key', /\b(sk-or-v1-[A-Za-z0-9]{40,})\b/],
  ['secret/anthropic-key', /\b(sk-ant-[A-Za-z0-9_-]{40,})\b/],
  ['secret/openai-key', /\b(sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{40,})\b/],
  ['secret/stripe-live-key', /\b((?:sk|rk)_live_[A-Za-z0-9]{20,})\b/],
  ['secret/aws-access-key', /\b((?:AKIA|ASIA)[0-9A-Z]{16})\b/],
  ['secret/slack-token', /\b(xox[abprs]-[A-Za-z0-9-]{20,})\b/],
  ['secret/google-api-key', /\b(AIza[0-9A-Za-z_-]{35})\b/],
  ['secret/private-key', /(-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----)/],
];

/** Placeholders and test fixtures: `sk_live_xxx`, `ghp_XXXX…`, repeated or low-entropy bodies. */
export function looksFake(token) {
  if (token.startsWith('-----BEGIN')) return false;
  const lower = token.toLowerCase();
  if (/(x{4,}|example|dummy|fake|placeholder|redacted|changeme|your[_-]?|test[_-]?key|not[_-]?a[_-]?real)/.test(lower)) return true;
  if (/(.)\1{7,}/.test(token)) return true;
  const body = token.replace(/^[a-z]+[_-](?:[a-z0-9]+[_-])?/i, '');
  const counts = {};
  for (const c of body) counts[c] = (counts[c] ?? 0) + 1;
  const entropy = Object.values(counts).reduce((h, n) => h - (n / body.length) * Math.log2(n / body.length), 0);
  return entropy < 3.2;
}

/** Secret-looking tokens in a list of [line, text] pairs. */
export function scanLines(pairs) {
  const hits = [];
  for (const [line, text] of pairs) {
    for (const [rule, re] of SECRET_PATTERNS) {
      const m = re.exec(text);
      if (m && !looksFake(m[1])) {
        hits.push({ line, rule, token: m[1] });
        break;
      }
    }
  }
  return hits;
}

const redact = (t) => (t.length > 12 ? `${t.slice(0, 8)}…${t.slice(-2)}` : `${t.slice(0, 4)}…`);

function d1(root, diff) {
  const out = [];
  for (const f of live(diff)) {
    const base = posix.basename(f.path);
    if (f.status !== 'D' && /^\.env(\..+)?$/.test(base) && !/\.(example|sample|template|dist)$/.test(base)) {
      out.push(
        finding('D1', 'secret/env-file', 'CRITICAL', f.path, null, null, `${f.path} is in the diff`, '`.env` files hold real keys and are git-ignored for that reason (root CLAUDE.md → Do not touch).', {
          suggestion: `\`git rm --cached ${f.path}\`, and rotate any key it held.`,
        }),
      );
    }
    for (const hit of scanLines(f.added_text)) {
      out.push(
        finding('D1', hit.rule, 'CRITICAL', f.path, hit.line, hit.line, `Secret-shaped token ${redact(hit.token)}`, 'A real credential in the diff is leaked as soon as it is pushed, and stays in git history.', {
          suggestion: 'Remove it, load it from the environment or the secrets adapter, and rotate the key.',
        }),
      );
    }
  }
  return result('D1', 'Secrets', out);
}

/** Secrets in every commit about to be pushed, not only in the final tree. */
export function scanPushedCommits(root, sha, remote) {
  return scanCommits(root, [sha, '--not', `--remotes=${remote}`]);
}

/** Secrets added by any commit in a rev range (`git log` arguments). */
export function scanCommits(root, revs) {
  const out = git(['log', '-p', '-a', '--no-ext-diff', '--no-color', '--format=%x1e%H', ...revs], {
    cwd: root,
    trim: false,
  });
  const hits = [];
  for (const chunk of out.split('\x1e').filter(Boolean)) {
    const commit = chunk.slice(0, 40);
    let file = null;
    const pairs = [];
    for (const line of chunk.split('\n')) {
      if (line.startsWith('+++ ')) file = line.slice(4).replace(/^b\//, '');
      else if (line.startsWith('+') && file) pairs.push([file, line.slice(1)]);
    }
    for (const [path, text] of pairs) {
      for (const hit of scanLines([[0, text]])) hits.push({ commit, path, rule: hit.rule, token: redact(hit.token) });
    }
  }
  return hits;
}

// ---------------------------------------------------------------- D2 do-not-touch

function d2(root, diff) {
  const out = [];
  const paths = new Set(diff.files.map((f) => f.path));
  const treeFiles = git(['ls-tree', '-r', '--name-only', diff.tree], { cwd: root }).split('\n');
  for (const f of diff.files) {
    if (matchAny(f.path, ['server/clones/**'])) {
      out.push(finding('D2', 'dnt/clones', 'CRITICAL', f.path, null, null, 'Cloned user repo in the diff', '`server/clones/**` is runtime data (root CLAUDE.md → Do not touch).', { waivable: true }));
    }
    if (matchAny(f.path, ['**/src/vendor/**']) && !matchAny(f.path, ['server/src/vendor/shared/**', 'client/src/vendor/shared/**'])) {
      out.push(finding('D2', 'dnt/vendor', 'CRITICAL', f.path, null, null, 'Vendored file edited', '`**/src/vendor/**` is vendored and read-only (root CLAUDE.md → Do not touch).', { waivable: true }));
    }
    if (posix.basename(f.path) === 'next-env.d.ts') {
      out.push(finding('D2', 'dnt/generated-file', 'CRITICAL', f.path, null, null, 'Generated next-env.d.ts in the diff', '`next dev` rewrites it; client CLAUDE.md lists it under Do not touch.', { waivable: true }));
    }
    if (matchAny(f.path, ['server/src/modules/repo-intel/**'])) {
      out.push(finding('D2', 'dnt/repo-intel-internals', 'WARNING', f.path, null, null, 'repo-intel internals changed', 'server CLAUDE.md: build on the `repoIntel.*` facade, leave the internals alone.', { waivable: true }));
    }
    const base = posix.basename(f.path);
    if (LOCKFILES.includes(base)) {
      const dir = posix.dirname(f.path);
      const manifest = dir === '.' ? 'package.json' : `${dir}/package.json`;
      if (!paths.has(manifest)) {
        out.push(
          finding('D2', 'dnt/lockfile-without-manifest', 'CRITICAL', f.path, null, null, `${base} changed but ${manifest} did not`, 'Lockfiles change only through the package manager, together with the manifest (root CLAUDE.md → Do not touch).', {
            waivable: true,
            suggestion: 'If this is a deliberate `pnpm update` / `npm update`, waive it with that reason.',
          }),
        );
      }
      if (f.status === 'A') {
        const others = LOCKFILES.filter((l) => l !== base && treeFiles.includes(dir === '.' ? l : `${dir}/${l}`));
        if (others.length) {
          out.push(finding('D2', 'dnt/second-lockfile', 'CRITICAL', f.path, null, null, `Second lockfile next to ${others.join(', ')}`, 'Use the package manager whose lockfile is already there — never create a second one (root CLAUDE.md).', { waivable: true }));
        }
      }
    }
  }
  return result('D2', 'Do not touch', out);
}

// ---------------------------------------------------------------- D3 migrations

const MIGRATION_SQL = /^server\/src\/db\/migrations\/\d{4}_[^/]+\.sql$/;
const MIGRATION_SNAPSHOT = /^server\/src\/db\/migrations\/meta\/\d{4}_snapshot\.json$/;
const JOURNAL = 'server/src/db/migrations/meta/_journal.json';

function d3(root, diff) {
  const out = [];
  for (const f of diff.files) {
    const old = f.old_path ?? f.path;
    if ((MIGRATION_SQL.test(old) || MIGRATION_SNAPSHOT.test(old)) && f.status !== 'A') {
      out.push(
        finding('D3', 'migrations/edited', 'CRITICAL', f.path, null, null, `Existing migration ${posix.basename(old)} ${f.status === 'D' ? 'deleted' : f.status === 'R' ? 'renamed' : 'edited'}`, 'Applied migrations are history: databases that already ran them never see the change. Migrations are generated (`pnpm db:generate`), never edited.', {
          waivable: true,
          suggestion: 'Revert it and generate a new migration for the schema change.',
        }),
      );
    }
    if (f.path === JOURNAL && f.status === 'M') {
      const before = JSON.parse(baseTextOf(root, diff, f.old_path) ?? '{"entries":[]}');
      const after = JSON.parse(textOf(root, diff, f.path) ?? '{"entries":[]}');
      const prefixKept = before.entries.every((e, i) => JSON.stringify(e) === JSON.stringify(after.entries[i]));
      if (!prefixKept || before.dialect !== after.dialect) {
        out.push(finding('D3', 'migrations/journal-rewritten', 'CRITICAL', f.path, null, null, 'Migration journal rewritten, not appended', '`_journal.json` may only grow: drizzle replays it in order.', { waivable: true }));
      }
    }
  }
  const schemaChanged = diff.files.some((f) => matchAny(f.path, ['server/src/db/schema.ts', 'server/src/db/schema/**']) && f.added_count + f.removed_count > 0);
  const newMigration = diff.files.some((f) => MIGRATION_SQL.test(f.path) && f.status === 'A');
  if (schemaChanged && !newMigration) {
    const f = diff.files.find((x) => matchAny(x.path, ['server/src/db/schema.ts', 'server/src/db/schema/**']));
    out.push(
      finding('D3', 'migrations/schema-without-migration', 'CRITICAL', f.path, f.added[0]?.[0] ?? null, f.added[0]?.[1] ?? null, 'Schema changed without a new migration', 'A table or column change needs `pnpm db:generate`; without it the code expects a column the database doesn\'t have (`relation … does not exist`). Type-only or relation-only edits need no migration — the verifier decides.', {
        waivable: true,
        needs_verification: true,
        suggestion: '`cd server && pnpm db:generate`, then commit the new migration.',
      }),
    );
  }
  return result('D3', 'Migrations', out);
}

// ---------------------------------------------------------------- D4 contracts

function d4(root, diff) {
  const out = [];
  const blobs = (dir) => {
    const map = new Map();
    for (const line of git(['ls-tree', '-r', diff.tree, '--', dir], { cwd: root }).split('\n').filter(Boolean)) {
      const m = /^\d+ blob ([0-9a-f]+)\t(.*)$/.exec(line);
      if (m) map.set(m[2].slice(dir.length + 1), m[1]);
    }
    return map;
  };
  const touched = diff.files.some((f) => matchAny(f.path, ['server/src/vendor/shared/**', 'client/src/vendor/shared/**']));
  if (touched) {
    const server = blobs('server/src/vendor/shared');
    const client = blobs('client/src/vendor/shared');
    const differ = [...new Set([...server.keys(), ...client.keys()])].filter((k) => server.get(k) !== client.get(k));
    if (differ.length) {
      out.push(
        finding('D4', 'contracts/mirror-drift', 'CRITICAL', `client/src/vendor/shared/${differ[0]}`, null, null, `client/src/vendor/shared differs from the server copy in ${differ.length} file(s)`, `The client copy is a hand-mirror with no sync script; client.yml fails on any \`diff -r\`. Differs: ${differ.slice(0, 8).join(', ')}${differ.length > 8 ? ', …' : ''}.`, {
          suggestion: 'Copy the changed server files into client/src/vendor/shared/.',
        }),
      );
    }
  }
  for (const f of live(diff)) {
    if (f.status === 'D' || !matchAny(f.path, ['client/src/**/*.{ts,tsx}']) || matchAny(f.path, ['client/src/vendor/**'])) continue;
    if (!f.added_text.some(([, t]) => t.includes('@devdigest/shared'))) continue;
    const text = textOf(root, diff, f.path) ?? '';
    const re = /^[ \t]*(?:import|export)\b([^;]*?)\bfrom\s*['"]@devdigest\/shared(?:\/[^'"]*)?['"]|^[ \t]*import\s*['"]@devdigest\/shared(?:\/[^'"]*)?['"]/gm;
    for (const m of text.matchAll(re)) {
      if (/^\s*type\b/.test(m[1] ?? '')) continue;
      const start = text.slice(0, m.index).split('\n').length;
      const end = start + m[0].split('\n').length - 1;
      if (!f.added.some(([s, e]) => start <= e && end >= s)) continue;
      out.push(
        finding('D4', 'contracts/client-runtime-shared-import', 'CRITICAL', f.path, start, end, 'Runtime import from @devdigest/shared in the client', 'client CLAUDE.md: import types only — a runtime import breaks the webpack build (with verbatimModuleSyntax even `import { type X }` stays a runtime import).', {
          suggestion: 'Use `import type { … } from "@devdigest/shared"`; copy runtime values (as src/lib/feature-models.ts does).',
        }),
      );
    }
  }
  return result('D4', 'Contracts', out);
}

// ---------------------------------------------------------------- D5 INSIGHTS

/** Index of the first old line that is not, in order, in the new file; -1 if all are. */
export function firstLostLine(oldText, newText) {
  const oldLines = oldText.replace(/\n$/, '').split('\n');
  const newLines = newText.replace(/\n$/, '').split('\n');
  let j = 0;
  for (let i = 0; i < oldLines.length; i++) {
    while (j < newLines.length && newLines[j] !== oldLines[i]) j++;
    if (j === newLines.length) return i;
    j++;
  }
  return -1;
}

function d5(root, diff) {
  const out = [];
  for (const f of diff.files) {
    if (posix.basename(f.old_path ?? f.path) !== 'INSIGHTS.md' || f.status === 'A' || f.excluded) continue;
    if (f.status === 'D') {
      out.push(finding('D5', 'insights/deleted', 'CRITICAL', f.path, null, null, 'INSIGHTS.md deleted', 'INSIGHTS.md files are append-only: accumulated knowledge is never removed.'));
      continue;
    }
    const before = baseTextOf(root, diff, f.old_path) ?? '';
    const after = textOf(root, diff, f.path) ?? '';
    const lost = firstLostLine(before, after);
    if (lost !== -1) {
      const text = before.split('\n')[lost];
      out.push(
        finding('D5', 'insights/rewritten', 'CRITICAL', f.path, null, null, `Existing INSIGHTS line ${lost + 1} was changed or removed`, `INSIGHTS.md is append-only; write to it only through engineering-insights' append-insight.mjs. Lost line: "${text.slice(0, 160)}"`, {
          suggestion: 'Restore the original line; add new knowledge as a dated sub-bullet with the script.',
        }),
      );
    }
  }
  return result('D5', 'INSIGHTS append-only', out);
}

// ---------------------------------------------------------------- commands

function run(cmd, args, cwd, timeoutMs = 300_000) {
  return new Promise((resolve) => {
    const started = Date.now();
    let output = '';
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: { ...process.env, FORCE_COLOR: '0', CI: process.env.CI ?? '' } });
    } catch (e) {
      resolve({ code: 127, output: String(e), ms: 0 });
      return;
    }
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: 127, output: `${output}${e.message}`, ms: Date.now() - started });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code: signal ? 124 : code, output, ms: Date.now() - started });
    });
  });
}

/**
 * Run a package.json script's command directly, with the package's
 * node_modules/.bin on PATH — what `pnpm run` / `npm run` do, minus their
 * dependency check. pnpm 12 verifies dependencies before `pnpm <script>` and,
 * when node_modules looks stale, installs: that failed with ERR_PNPM_IGNORED_BUILDS,
 * left a pnpm-workspace.yaml stub in the package and rewrote node_modules state,
 * and `npm_config_verify_deps_before_run=false` did not stop it. A review must not
 * change the working copy, so it never goes through the package manager.
 */
function runScript(pkgDir, name, timeoutMs) {
  let script;
  try {
    script = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).scripts?.[name];
  } catch {
    script = undefined;
  }
  if (!script) return Promise.resolve({ code: 127, output: `no "${name}" script in ${pkgDir}/package.json`, ms: 0 });
  const bin = join(pkgDir, 'node_modules', '.bin');
  return new Promise((resolve) => {
    const started = Date.now();
    let output = '';
    const child = spawn('sh', ['-c', script], {
      cwd: pkgDir,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FORCE_COLOR: '0', CI: process.env.CI ?? '' },
    });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs ?? 300_000);
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: 127, output: `${output}${e.message}`, ms: Date.now() - started });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code: signal ? 124 : code, output, ms: Date.now() - started });
    });
  });
}

const tail = (text, n = 25) => text.trim().split('\n').slice(-n).join('\n');

/** The command could not run (install/tooling problem), as opposed to reporting real errors. */
const ENV_FAILURE = /ERR_PNPM_|installing dependencies|command not found|ENOENT|EACCES/;

// ---------------------------------------------------------------- D6 architecture

function allowedMap(text) {
  const m = /const ALLOWED[^=]*=\s*\{([\s\S]*?)\};/.exec(text ?? '');
  const map = new Map();
  if (!m) return map;
  for (const e of m[1].matchAll(/['"]([^'"]+)['"]\s*:\s*([^,\n]+)/g)) map.set(e[1], e[2].trim());
  return map;
}

async function d6(root, diff, { mode }) {
  const touched = diff.files.some((f) => matchAny(f.path, ['server/src/**', 'reviewer-core/src/**', 'server/.dependency-cruiser*', 'server/test/routes-container-ratchet.test.ts', 'server/test/migrations-safety.test.ts']));
  if (!touched) return result('D6', 'Architecture', [], { status: 'skip', notes: ['no server or reviewer-core source changed'] });
  const out = [];
  const notes = [];
  const started = Date.now();

  for (const [file, numeric] of [
    ['server/test/routes-container-ratchet.test.ts', true],
    ['server/test/migrations-safety.test.ts', false],
  ]) {
    const beforeText = baseTextOf(root, diff, file);
    if (beforeText === null) continue; // a ratchet this branch introduces can't have been loosened
    const before = allowedMap(beforeText);
    const after = allowedMap(textOf(root, diff, file));
    const grew = [...after].filter(([k, v]) => !before.has(k) || (numeric && Number(v) > Number(before.get(k))));
    if (grew.length) {
      out.push(finding('D6', 'arch/ratchet-loosened', 'CRITICAL', file, null, null, `ALLOWED grew: ${grew.map(([k]) => k).join(', ')}`, 'The ratchet maps may only shrink; growing one hides a new violation from CI.', { suggestion: 'Fix the code instead of allowlisting it.' }));
    }
  }

  const baseline = await run('node', [join(root, '.claude/skills/onion-architecture/scripts/baseline-diff.mjs'), diff.base_sha], root);
  const addedCount = Number(/^added (\d+)$/m.exec(baseline.output)?.[1] ?? 0);
  if (addedCount > 0) {
    out.push(finding('D6', 'arch/baseline-grew', 'CRITICAL', 'server/.dependency-cruiser-known-violations.json', null, null, 'The onion baseline gained known violations', `The baseline freezes legacy debt; it never grows. baseline-diff.mjs ${diff.base_sha.slice(0, 12)}:\n${tail(baseline.output, 15)}`));
  } else if (baseline.code !== 0) {
    notes.push(`baseline-diff could not run: ${tail(baseline.output, 3)}`);
  }

  if (mode !== 'ci' && !existsSync(join(root, 'server/package.json'))) notes.push('no server/package.json: pnpm arch skipped');
  else if (mode !== 'ci') {
    if (!existsSync(join(root, 'server/node_modules')) || !existsSync(join(root, 'reviewer-core/node_modules'))) {
      return result('D6', 'Architecture', out, { status: 'error', notes: [...notes, 'server/ or reviewer-core/ has no node_modules: run `pnpm install` in server/ and `npm ci` in reviewer-core/'], ms: Date.now() - started });
    }
    const [arch, stale] = await Promise.all([runScript(join(root, 'server'), 'arch'), runScript(join(root, 'server'), 'arch:stale')]);
    const broken = [arch, stale].find((r) => r.code !== 0 && (r.code === 127 || ENV_FAILURE.test(r.output)));
    if (broken) {
      return result('D6', 'Architecture', out, { status: 'error', notes: [...notes, `pnpm arch could not run — fix the install and rerun:\n${tail(broken.output, 6)}`], ms: Date.now() - started });
    }
    if (arch.code !== 0) out.push(finding('D6', 'arch/boundary', 'CRITICAL', 'server/.dependency-cruiser.cjs', null, null, '`pnpm arch` fails: a new onion boundary violation', `${tail(arch.output)}`, { suggestion: 'Move the code to the right ring or add a port (onion-architecture skill); never grow the baseline.' }));
    if (stale.code !== 0) out.push(finding('D6', 'arch/stale-baseline', 'CRITICAL', 'server/.dependency-cruiser-known-violations.json', null, null, '`pnpm arch:stale` fails', `${tail(stale.output, 10)}`, { suggestion: '`pnpm arch:baseline`, then baseline-diff.mjs must say "added 0".' }));
  }
  return result('D6', 'Architecture', out, { notes, ms: Date.now() - started });
}

// ---------------------------------------------------------------- D7 build

const PACKAGES = [
  { name: 'server', dir: 'server', pm: 'pnpm', touch: ['server/**/*.{ts,mts,json}', 'reviewer-core/src/**', 'server/tsconfig*.json'], test: 'test:unit' },
  { name: 'reviewer-core', dir: 'reviewer-core', pm: 'npm', touch: ['reviewer-core/**/*.{ts,json}', 'server/src/vendor/shared/**'], test: 'test' },
  { name: 'client', dir: 'client', pm: 'pnpm', touch: ['client/**/*.{ts,tsx,json,mjs}'], test: 'test' },
  { name: 'e2e', dir: 'e2e', pm: 'npm', touch: ['e2e/**/*.ts', 'e2e/tsconfig.json'], test: null },
];

async function d7(root, diff, { full }) {
  const started = Date.now();
  const changed = diff.files.filter((f) => !f.excluded).map((f) => f.path);
  const pkgs = PACKAGES.filter(
    (p) => existsSync(join(root, p.dir, 'package.json')) && changed.some((path) => matchAny(path, p.touch) && !path.includes('/node_modules/')),
  );
  if (!pkgs.length) return result('D7', 'Typecheck', [], { status: 'skip', notes: ['no TypeScript package changed'] });
  const out = [];
  const notes = [];
  let error = false;
  const jobs = [];
  for (const p of pkgs) {
    if (!existsSync(join(root, p.dir, 'node_modules'))) {
      notes.push(`${p.dir}/ has no node_modules: install it (${p.pm === 'pnpm' ? 'pnpm install' : 'npm ci'})`);
      error = true;
      continue;
    }
    jobs.push(runScript(join(root, p.dir), 'typecheck').then((r) => ({ p, kind: 'typecheck', r })));
    if (full && p.test) jobs.push(runScript(join(root, p.dir), p.test, 600_000).then((r) => ({ p, kind: 'test', r })));
  }
  const lockChanged = (p) => diff.files.some((f) => posix.dirname(f.path) === p.dir && LOCKFILES.includes(posix.basename(f.path)));
  for (const { p, kind, r } of await Promise.all(jobs)) {
    notes.push(`${p.dir} ${kind}: ${r.code === 0 ? 'ok' : `exit ${r.code}`} (${(r.ms / 1000).toFixed(1)} s)`);
    if (r.code === 0) continue;
    const envProblem =
      r.code === 127 ||
      r.code === 124 ||
      ENV_FAILURE.test(r.output) ||
      (lockChanged(p) && /Cannot find module '(?![./])|ERR_MODULE_NOT_FOUND/.test(r.output));
    if (envProblem) {
      error = true;
      notes.push(`${p.dir} ${kind} could not run cleanly — reinstall dependencies and rerun:\n${tail(r.output, 6)}`);
      continue;
    }
    out.push(
      finding('D7', kind === 'typecheck' ? 'build/typecheck' : 'build/unit-tests', 'CRITICAL', `${p.dir}/package.json`, null, null, `${p.dir}: ${kind} fails`, tail(r.output, 30), {
        suggestion: `Run \`cd ${p.dir} && ${p.pm} ${kind === 'typecheck' ? 'typecheck' : `run ${p.test}`}\` and fix the errors.`,
      }),
    );
  }
  return result('D7', full ? 'Typecheck + unit tests' : 'Typecheck', out, { notes, status: error ? 'error' : undefined, ms: Date.now() - started });
}

// ---------------------------------------------------------------- D8 spec zones

function d8(root, diff) {
  const out = [];
  const changed = live(diff).filter((f) => f.status !== 'D' && !f.generated && !f.pure_rename);
  for (const spec of linkSpecs(root, diff).filter((s) => s.active)) {
    const zone = unchangedZone(spec.text);
    for (const item of zone.items) {
      const hit = changed.filter((f) => f.path !== spec.path && inZone(f.path, item));
      if (!hit.length) continue;
      const first = hit[0];
      out.push(
        finding('D8', 'spec/unchanged-zone', 'CRITICAL', first.path, first.added[0]?.[0] ?? null, first.added[0]?.[1] ?? null, `Changes \`${item}\` (${hit.length} file(s)), listed as Unchanged in ${spec.path}`, `${spec.path}:${zone.line} lists \`${item}\` under "Unchanged (no diff at all)". Files: ${hit.map((f) => f.path).join(', ')}. An Amendment later in the spec may have taken it off the list — the verifier reads the whole spec.`, {
          waivable: true,
          needs_verification: true,
          category: 'bug',
        }),
      );
    }
  }
  return result('D8', 'Spec "Unchanged" zones', out);
}

// ---------------------------------------------------------------- D10 tests

function d10(root, diff) {
  const out = [];
  const changed = new Set(live(diff).map((f) => f.path));
  const changedTests = [...changed].filter((p) => /\.test\.(ts|tsx|mts)$/.test(p));
  for (const f of live(diff)) {
    if (f.status === 'D' || f.pure_rename || f.added_count < 3) continue;
    let expect = null;
    let ok = false;
    const mod = /^server\/src\/modules\/([^/]+)\/(domain|service)\.ts$/.exec(f.path);
    if (mod) {
      const [, m, kind] = mod;
      const stem = m.replace(/s$/, '');
      ok = changedTests.some((t) => t.startsWith('server/test/') && (t.includes(m) || t.includes(stem)));
      expect = `server/test/${m}-${kind}.test.ts`;
    } else if (
      matchAny(f.path, ['client/src/**/helpers.ts', 'client/src/lib/*.ts', 'client/src/lib/hooks/*.ts']) &&
      !matchAny(f.path, ['**/*.test.ts', '**/types.ts', '**/index.ts', '**/constants.ts', '**/*.d.ts'])
    ) {
      const dir = posix.dirname(f.path);
      ok = changedTests.some((t) => posix.dirname(t) === dir);
      expect = `${dir}/${posix.basename(f.path, '.ts')}.test.ts`;
    } else if (matchAny(f.path, ['reviewer-core/src/**/*.ts']) && !matchAny(f.path, ['**/index.ts', '**/*.d.ts'])) {
      ok = changedTests.some((t) => t.startsWith('reviewer-core/test/'));
      expect = 'reviewer-core/test/<module>.test.ts';
    }
    if (expect && !ok) {
      out.push(
        finding('D10', 'test/logic-without-test', 'WARNING', f.path, f.added[0]?.[0] ?? null, f.added[0]?.[1] ?? null, `Logic changed (+${f.added_count}) with no test change`, `Pure logic is cheap to test and is where regressions hide (onion-architecture → Testing by ring; frontend-ui-architecture: logic lives in testable helpers). Expected a change in ${expect}.`, {
          category: 'test',
          suggestion: `Add or update ${expect}.`,
        }),
      );
    }
  }
  return result('D10', 'Logic without tests', out);
}

// ---------------------------------------------------------------- D11 commits

const CONVENTIONAL = /^(feat|fix|docs|chore|refactor|test|perf|ci|build|style|revert)(\([^)]+\))?!?: \S/;

function d11(root, diff) {
  const out = [];
  for (const c of diff.commits) {
    if (c.merge) continue;
    const short = c.sha.slice(0, 8);
    if (/^(fixup|squash|amend)! /.test(c.subject) || /\bwip\b/i.test(c.subject)) {
      out.push(finding('D11', 'commits/unfinished', 'WARNING', `(commit ${short})`, null, null, `Unfinished commit: "${c.subject}"`, 'fixup!/squash!/WIP commits should be squashed before review.', { category: 'style', suggestion: 'Squash with `git rebase -i --autosquash`.' }));
    } else if (!CONVENTIONAL.test(c.subject)) {
      out.push(finding('D11', 'commits/not-conventional', 'WARNING', `(commit ${short})`, null, null, `"${c.subject}" is not \`type(scope): …\``, 'The repo writes Conventional Commits (`feat(server): …`, `docs: …`, `chore(skills): …`).', { category: 'style' }));
    }
  }
  return result('D11', 'Commit hygiene', out);
}

// ---------------------------------------------------------------- S small rules

function small(root, diff) {
  const out = [];
  const paths = new Set(diff.files.map((f) => f.path));
  const flows = () =>
    git(['ls-tree', '-r', '--name-only', diff.tree, '--', 'e2e/specs'], { cwd: root })
      .split('\n')
      .filter((p) => p.endsWith('.flow.json'))
      .map((p) => {
        try {
          return { path: p, json: JSON.parse(textOf(root, diff, p) ?? 'null') };
        } catch {
          return { path: p, json: null };
        }
      });
  const leaves = (obj, acc = []) => {
    if (typeof obj === 'string') acc.push(obj);
    else if (obj && typeof obj === 'object') for (const v of Object.values(obj)) leaves(v, acc);
    return acc;
  };

  for (const f of live(diff)) {
    if (f.status === 'D') continue;
    if (matchAny(f.path, ['client/messages/**/*.json'])) {
      let after;
      try {
        after = JSON.parse(textOf(root, diff, f.path));
      } catch (e) {
        out.push(finding('S', 'i18n/invalid-json', 'CRITICAL', f.path, null, null, 'Invalid JSON in a messages file', `next-intl loads every file in messages/en/ at runtime: ${e.message}`));
        continue;
      }
      const beforeText = baseTextOf(root, diff, f.old_path);
      if (beforeText) {
        const now = leaves(after);
        const removed = leaves(JSON.parse(beforeText)).filter((s) => !now.includes(s));
        for (const flow of flows()) {
          const args = (flow.json?.steps ?? []).flatMap((s) => s.cmd ?? []).filter((a) => typeof a === 'string' && a.length > 3 && !a.startsWith('-') && !a.includes('{BASE}'));
          for (const arg of args) {
            if (removed.some((s) => s.includes(arg)) && !now.some((s) => s.includes(arg))) {
              out.push(finding('S', 'e2e/asserted-copy-removed', 'CRITICAL', f.path, null, null, `"${arg}" is gone, but ${flow.path} asserts it`, 'e2e flows match visible text (client CLAUDE.md → no data-testids), so e2e-web will fail.', { suggestion: `Keep the copy, or update ${flow.path} in the same change.` }));
            }
          }
        }
      }
    }
    if (matchAny(f.path, ['e2e/specs/*.flow.json'])) {
      let json = null;
      try {
        json = JSON.parse(textOf(root, diff, f.path));
      } catch (e) {
        out.push(finding('S', 'e2e/invalid-flow-json', 'CRITICAL', f.path, null, null, 'Invalid flow JSON', e.message));
      }
      if (!/^\d{2}-[a-z0-9-]+\.flow\.json$/.test(posix.basename(f.path))) {
        out.push(finding('S', 'e2e/flow-name', 'WARNING', f.path, null, null, 'Flow file is not `NN-kebab.flow.json`', 'e2e CLAUDE.md → Naming: the number sets the run order.', { category: 'style' }));
      }
      if (json && (json.steps ?? []).some((s) => (s.cmd ?? [])[0] === 'chat')) {
        out.push(finding('S', 'e2e/ai-chat-command', 'CRITICAL', f.path, null, null, 'Flow uses the AI `chat` command', 'e2e CLAUDE.md: deterministic locators only — never the AI `chat` command.', { waivable: true }));
      }
    }
    if (matchAny(f.path, ['server/src/db/schema/*.ts'])) {
      const schemaTs = textOf(root, diff, 'server/src/db/schema.ts') ?? '';
      const objectPart = schemaTs.slice(schemaTs.indexOf('export const schema'));
      for (const [line, text] of f.added_text) {
        const m = /export const (\w+)\s*=\s*pgTable\(/.exec(text);
        if (m && !new RegExp(`\\b${m[1]}\\b`).test(objectPart)) {
          out.push(finding('S', 'db/table-not-in-schema', 'WARNING', f.path, line, line, `\`${m[1]}\` is not in the \`schema\` object`, 'server CLAUDE.md: a new table goes in src/db/schema/*.ts and in the `schema` object of src/db/schema.ts.', { suggestion: `Import ${m[1]} in src/db/schema.ts and add it to \`schema\`.` }));
        }
      }
    }
    if (posix.basename(f.path) === 'CLAUDE.md') {
      const n = (textOf(root, diff, f.path) ?? '').replace(/\n$/, '').split('\n').length;
      if (n >= 100) out.push(finding('S', 'docs/claude-md-too-long', 'WARNING', f.path, null, null, `${f.path} has ${n} lines`, 'Every CLAUDE.md stays under 100 lines: move detail to a linked doc or a skill.', { category: 'style' }));
    }
    if (matchAny(f.path, ['.github/workflows/*.{yml,yaml}'])) {
      const text = textOf(root, diff, f.path) ?? '';
      text.split('\n').forEach((l, i) => {
        const m = /^\s*-?\s*uses:\s*([^\s#]+)@([^\s#]+)/.exec(l);
        if (m && !m[1].startsWith('./') && !/^[0-9a-f]{40}$/.test(m[2])) {
          out.push(finding('S', 'ci/unpinned-action', 'WARNING', f.path, i + 1, i + 1, `${m[1]}@${m[2]} is not pinned to a commit SHA`, 'TESTING.md: actions are pinned to a SHA, the tag in a trailing comment.', { category: 'security' }));
        }
      });
      const jobs = (text.match(/^\s+runs-on:/gm) ?? []).length;
      const timeouts = (text.match(/^\s+timeout-minutes:/gm) ?? []).length;
      if (jobs > timeouts) out.push(finding('S', 'ci/no-timeout', 'WARNING', f.path, null, null, `${jobs - timeouts} job(s) without timeout-minutes`, 'TESTING.md: every job sets `timeout-minutes`.', { category: 'style' }));
      if (!/^permissions:/m.test(text)) out.push(finding('S', 'ci/no-permissions', 'WARNING', f.path, null, null, 'No top-level `permissions:`', 'Give the workflow token least privilege (`contents: read`).', { category: 'security' }));
    }
  }
  const prompts = diff.files.some((f) => matchAny(f.path, ['docs/agent-prompts/*-reviewer.md']));
  const seed = paths.has('server/src/db/seed-prompts.ts');
  if (prompts !== seed && (prompts || seed)) {
    out.push(finding('S', 'docs/agent-prompts-out-of-sync', 'WARNING', prompts ? 'server/src/db/seed-prompts.ts' : 'docs/agent-prompts/README.md', null, null, 'Agent prompt changed in one place only', 'seed-prompts.ts mirrors docs/agent-prompts/*.md; keep the two in sync.', { category: 'style' }));
  }
  for (const f of diff.files) {
    if (f.status === 'A' && matchAny(f.path, ['.claude/skills/*/evals/**'])) {
      out.push(finding('S', 'skills/evals-in-repo', 'WARNING', f.path, null, null, 'Eval set inside the repo', 'Eval executors that grep the repo read the expected answers (root INSIGHTS.md): keep evals outside the repo or exclude `.claude/` from their searches.', { category: 'test' }));
      break;
    }
  }
  return result('S', 'Small rules', out);
}

// ---------------------------------------------------------------- reminder

function insightsReminder(diff) {
  const scopes = new Map();
  for (const f of live(diff)) {
    if (posix.basename(f.path) === 'INSIGHTS.md') continue;
    const top = f.path.split('/')[0];
    const scope = f.path.startsWith('server/src/modules/repo-intel/')
      ? 'server/src/modules/repo-intel/INSIGHTS.md'
      : ['client', 'server', 'reviewer-core', 'e2e'].includes(top)
        ? `${top}/INSIGHTS.md`
        : 'INSIGHTS.md';
    scopes.set(scope, (scopes.get(scope) ?? 0) + 1);
  }
  const touched = new Set(diff.files.map((f) => f.path));
  const notes = [...scopes].filter(([s]) => !touched.has(s)).map(([s, n]) => `${n} file(s) changed under ${s.replace(/INSIGHTS\.md$/, '') || 'the root'} but ${s} did not — run the engineering-insights wrap-up ("nothing new" is a fine result).`);
  return result('INSIGHTS', 'INSIGHTS reminder', [], { status: notes.length ? 'warn' : 'pass', notes });
}

// ---------------------------------------------------------------- runner

/** The fast, tree-only checks the push gate runs when no reviewer applies. */
export function cheapChecks(root, diff) {
  return [d1(root, diff), d2(root, diff), d3(root, diff), d4(root, diff), d5(root, diff), small(root, diff)];
}

/**
 * @param mode 'full' | 'quick' (no typecheck) | 'ci' (tree-only: no node_modules needed)
 */
export async function runChecks(root, diff, { mode = 'full', full = false } = {}) {
  const timed = (fn) => {
    const t = Date.now();
    const r = fn();
    r.ms = r.ms || Date.now() - t;
    return r;
  };
  const sync = [
    timed(() => d1(root, diff)),
    timed(() => d2(root, diff)),
    timed(() => d3(root, diff)),
    timed(() => d4(root, diff)),
    timed(() => d5(root, diff)),
    timed(() => d8(root, diff)),
    timed(() => {
      const findings = checkCitations(root, diff);
      return result('D9', 'Stale citations', findings);
    }),
    timed(() => d10(root, diff)),
    timed(() => d11(root, diff)),
    timed(() => small(root, diff)),
    timed(() => insightsReminder(diff)),
  ];
  const asyncChecks = [d6(root, diff, { mode })];
  if (mode === 'full') asyncChecks.push(d7(root, diff, { full }));
  else asyncChecks.push(Promise.resolve(result('D7', 'Typecheck', [], { status: 'skip', notes: [mode === 'quick' ? 'skipped in --quick' : 'not run in CI mode (package workflows type-check)'] })));
  const checks = [...sync, ...(await Promise.all(asyncChecks))].sort((a, b) => order(a.id) - order(b.id));
  return { checks, findings: checks.flatMap((c) => c.findings) };
}

const ORDER = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'S', 'INSIGHTS'];
const order = (id) => ORDER.indexOf(id);

export function formatChecks(checks) {
  const icon = { pass: '✓', warn: '!', fail: '✗', error: '?', skip: '·' };
  const lines = [];
  for (const c of checks) {
    const counts = ['CRITICAL', 'WARNING', 'SUGGESTION']
      .map((s) => [s, c.findings.filter((f) => f.severity === s).length])
      .filter(([, n]) => n)
      .map(([s, n]) => `${n} ${s}`)
      .join(', ');
    lines.push(`${icon[c.status]} ${c.id.padEnd(8)} ${c.title}${counts ? ` — ${counts}` : ''}${c.ms > 500 ? ` (${(c.ms / 1000).toFixed(1)} s)` : ''}`);
    for (const f of c.findings.filter((x) => x.severity === 'CRITICAL')) {
      lines.push(`    ${f.file}${f.start_line ? `:${f.start_line}` : ''} ${f.rule_id} — ${f.title}`);
    }
    for (const n of c.notes) lines.push(`    ${n.split('\n').join('\n    ')}`);
  }
  return lines.join('\n');
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2), { booleans: ['quick', 'full', 'ci'] });
  const root = repoRoot();
  if (args.ci) {
    const diff = collectDiff(root, { base: args.base, commit: 'HEAD' });
    const { checks, findings } = await runChecks(root, diff, { mode: 'ci' });
    console.log(formatChecks(checks));
    for (const hit of scanCommits(root, [`${diff.base_sha}..${diff.head_sha}`])) {
      findings.push(finding('D1', hit.rule, 'CRITICAL', hit.path, null, null, `Secret-shaped token ${hit.token} in commit ${hit.commit.slice(0, 8)}`, 'An intermediate commit of this PR adds a credential; it stays in history even if a later commit removes it.'));
      console.log(`✗ D1       ${hit.path}: ${hit.rule} (${hit.token}) in commit ${hit.commit.slice(0, 8)} — rotate the key and rewrite history`);
    }
    const blocking = findings.filter((f) => f.severity === 'CRITICAL' && !f.waivable && !f.needs_verification);
    const deferred = findings.filter((f) => f.severity === 'CRITICAL' && (f.waivable || f.needs_verification));
    if (deferred.length) console.log(`\n${deferred.length} waivable or to-be-verified CRITICAL(s) are left to the local self-review gate.`);
    if (blocking.length) {
      console.log(`\n${blocking.length} blocking CRITICAL(s).`);
      process.exit(1);
    }
    process.exit(0);
  }
  if (!args.run) {
    process.stderr.write('usage: checks.mjs --run <run-id> [--quick|--full]  |  checks.mjs --ci [--base <ref>]\n');
    process.exit(2);
  }
  const dir = runDir(root, args.run);
  const diff = readJson(join(dir, 'diff.json'));
  const p = readJson(join(dir, 'plan.json'));
  const mode = args.quick || p.mode === 'quick' ? 'quick' : 'full';
  const started = Date.now();
  const { checks, findings } = await runChecks(root, diff, { mode, full: Boolean(args.full) });
  writeJsonAtomic(join(dir, 'checks.json'), { run_id: args.run, mode, full: Boolean(args.full), ms: Date.now() - started, checks, findings });
  console.log(formatChecks(checks));
  console.log(`checks: ${((Date.now() - started) / 1000).toFixed(1)} s → ${join(dir, 'checks.json')}`);
}
