#!/usr/bin/env node
// Shrink-only check for server/.dependency-cruiser-known-violations.json, the
// onion-architecture baseline. It compares the working copy with the version at
// a git ref (default HEAD), prints before → after per rule, and exits 1 when a
// known violation was ADDED. Removals are the only allowed change: the baseline
// freezes legacy debt, it never grows.
//
//   node .claude/skills/onion-architecture/scripts/baseline-diff.mjs [ref]
//
// Why not `git diff`: the file is a JSON array, so removing one entry also
// rewrites a neighbouring line, and a diff of lines cannot prove "only removals".
// Read-only: it never writes a file. Runs from any directory.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const BASELINE = 'server/.dependency-cruiser-known-violations.json';
const ref = process.argv[2] ?? 'HEAD';

function fail(message) {
  process.stderr.write(`baseline-diff: ${message}\n`);
  process.exit(1);
}

function parse(text, where) {
  try {
    const value = JSON.parse(text);
    if (!Array.isArray(value)) fail(`${where} is not a JSON array`);
    return value;
  } catch (err) {
    return fail(`${where} is not valid JSON (${err.message})`);
  }
}

// ── identity of a violation ─────────────────────────────────────────────────
// dependency-cruiser matches a known violation by rule, from, to and (for
// cycles / reachability) the members of the path; cycle order is normalised.
const names = (list) => (list ?? []).map((m) => (typeof m === 'string' ? m : m.name)).sort();
const keyOf = (v) =>
  [v.rule?.name ?? '?', v.from, v.to, ...names(v.cycle), ...names(v.via)].join(' | ');
const label = (v) =>
  `${v.rule?.name ?? '?'}: ${v.from} → ${v.to}${v.cycle ? ` (cycle of ${v.cycle.length})` : ''}`;

function tally(list) {
  const byKey = new Map();
  for (const v of list) {
    const k = keyOf(v);
    const entry = byKey.get(k) ?? { v, n: 0 };
    entry.n += 1;
    byKey.set(k, entry);
  }
  return byKey;
}

function countByRule(list) {
  const counts = new Map();
  for (const v of list) counts.set(v.rule?.name ?? '?', (counts.get(v.rule?.name ?? '?') ?? 0) + 1);
  return counts;
}

// ── read both versions ──────────────────────────────────────────────────────
const workingPath = resolve(ROOT, BASELINE);
if (!existsSync(workingPath)) fail(`${BASELINE} not found — run \`cd server && pnpm arch:baseline\``);
const after = parse(readFileSync(workingPath, 'utf8'), `${BASELINE} (working copy)`);

let before = null;
try {
  const text = execFileSync('git', ['show', `${ref}:${BASELINE}`], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  before = parse(text, `${BASELINE} at ${ref}`);
} catch (err) {
  if (err?.status === undefined) throw err;
  before = null; // the file does not exist at that ref (or the ref is unknown)
}

// ── report ──────────────────────────────────────────────────────────────────
const afterByRule = countByRule(after);
if (before === null) {
  process.stdout.write(
    `baseline-diff: no ${BASELINE} at ${ref} — new baseline with ${after.length} entries\n`,
  );
  for (const [rule, n] of [...afterByRule].sort()) process.stdout.write(`  ${rule.padEnd(32)} ${n}\n`);
  process.exit(0);
}

const beforeByRule = countByRule(before);
const rules = [...new Set([...beforeByRule.keys(), ...afterByRule.keys()])].sort();
process.stdout.write(`baseline-diff: ${ref} → working copy\n`);
process.stdout.write(`  ${'rule'.padEnd(32)} before  after\n`);
for (const rule of rules) {
  const b = beforeByRule.get(rule) ?? 0;
  const a = afterByRule.get(rule) ?? 0;
  process.stdout.write(`  ${rule.padEnd(32)} ${String(b).padStart(6)} ${String(a).padStart(6)}\n`);
}

const beforeKeys = tally(before);
const afterKeys = tally(after);
const removed = [];
const added = [];
for (const [k, { v, n }] of beforeKeys) {
  const left = afterKeys.get(k)?.n ?? 0;
  for (let i = left; i < n; i++) removed.push(v);
}
for (const [k, { v, n }] of afterKeys) {
  const had = beforeKeys.get(k)?.n ?? 0;
  for (let i = had; i < n; i++) added.push(v);
}

process.stdout.write(`removed ${removed.length}\n`);
for (const v of removed) process.stdout.write(`  - ${label(v)}\n`);
process.stdout.write(`added ${added.length}\n`);
for (const v of added) process.stdout.write(`  + ${label(v)}\n`);

if (added.length > 0) {
  fail(
    `the baseline may only shrink — fix these imports instead of freezing them, ` +
      `or ask the user (skill onion-architecture → Enforcement).`,
  );
}
