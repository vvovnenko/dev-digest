#!/usr/bin/env node
// Routes the diff to the project skills that review it and writes the run.
//
//   node select-skills.mjs [--base <ref>] [--quick] [--budget <max-tasks>] [--summary]
//
// Without --summary it writes <store>/runs/<run-id>/{diff.json, plan.json,
// tasks/<task>.diff} and prints the plan; reviewers read only their task file.
// --summary prints the same plan and writes nothing (for SKILL.md's preview).
//
// Routing is deterministic (routing.json), so the same diff always gets the same
// reviewers and a verdict can be reproduced. Every folder in .claude/skills/
// must be routed or listed as ignored: a new skill fails the run until someone
// decides which files it reviews.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { collectDiff } from './collect-diff.mjs';
import {
  SKILL_DIR,
  TOOL_VERSION,
  isMain,
  matchAny,
  parseArgs,
  readJson,
  repoRoot,
  runDir,
  sha256,
  showFile,
  storeDir,
  writeJsonAtomic,
  writeTextAtomic,
} from './lib.mjs';
import { linkSpecs } from './specs.mjs';

const ROUTING_PATH = '.claude/skills/pr-self-review/routing.json';

/** Paths whose change could weaken this review; they need the user's OK. */
export const SELF_PATHS = ['.claude/skills/pr-self-review/**', '.claude/settings.json', '.claude/agents/pr-self-review-*'];

export function isSelfModified(diff) {
  return diff.files.some((f) => matchAny(f.path, SELF_PATHS) || (f.old_path && matchAny(f.old_path, SELF_PATHS)));
}

/**
 * routing.json as of the merge-base when the diff changes the review itself,
 * so a branch can't loosen the rules it is judged by. On the branch that adds
 * the skill there is no base version; the current one is used, and the run is
 * still marked self-modified.
 */
export function loadRouting(root, diff) {
  if (isSelfModified(diff)) {
    const atBase = showFile(root, diff.base_sha, ROUTING_PATH);
    if (atBase) return { routing: JSON.parse(atBase), source: `${diff.base_sha.slice(0, 12)}:${ROUTING_PATH}` };
  }
  return { routing: readJson(join(SKILL_DIR, 'routing.json')), source: ROUTING_PATH };
}

/** Skills in .claude/skills/ that routing.json neither routes nor ignores. */
export function driftCheck(root, routing) {
  const dir = join(root, '.claude/skills');
  if (!existsSync(dir)) return { unrouted: [], stale: [] };
  const present = readdirSync(dir).filter((d) => existsSync(join(dir, d, 'SKILL.md')));
  const known = new Set([...Object.keys(routing.skills), ...Object.keys(routing.ignored ?? {})]);
  return {
    unrouted: present.filter((d) => !known.has(d)),
    stale: Object.keys(routing.skills).filter((s) => !present.includes(s)),
  };
}

function ruleMatches(file, rule) {
  if (!matchAny(file.path, rule.include)) return false;
  if (rule.exclude && matchAny(file.path, rule.exclude)) return false;
  if (!rule.trigger) return true;
  const re = new RegExp(rule.trigger, 'm');
  return file.added_text.some(([, text]) => re.test(text));
}

/** Files each skill reviews. Deleted, binary, generated and excluded files go to none. */
export function route(diff, routing) {
  const reviewable = diff.files.filter(
    (f) => f.status !== 'D' && !f.binary && !f.generated && !f.excluded && !matchAny(f.path, routing.global_exclude ?? []),
  );
  const bySkill = {};
  const covered = new Set();
  for (const [skill, cfg] of Object.entries(routing.skills)) {
    const files = reviewable.filter(
      (f) => (!f.pure_rename || cfg.renames) && cfg.rules.some((rule) => ruleMatches(f, rule)),
    );
    if (files.length) bySkill[skill] = files;
    for (const f of files) covered.add(f.path);
  }
  const unreviewed = diff.files.filter((f) => !covered.has(f.path)).map((f) => f.path);
  return { bySkill, unreviewed };
}

/** Hash of everything that shapes a skill's findings, so a rule change empties its cache. */
function skillHash(root, skill, routing) {
  const parts = [TOOL_VERSION, JSON.stringify(routing.skills[skill] ?? {})];
  for (const file of ['references/severity.md', 'references/reviewer-brief.md']) {
    const p = join(SKILL_DIR, file);
    if (existsSync(p)) parts.push(readFileSync(p, 'utf8'));
  }
  const dir = join(root, '.claude/skills', skill);
  if (existsSync(dir)) for (const p of walk(dir)) if (!p.includes('/evals/')) parts.push(p, readFileSync(p, 'utf8'));
  return sha256(parts.join('\0'));
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

export function cacheKey(hash, file) {
  return sha256([hash, file.path, file.old_blob ?? '-', file.new_blob ?? '-', file.status].join('|'));
}

/** Split a skill's files into batches that fit one reviewer. */
function batches(files, { batch_files: maxFiles, batch_lines: maxLines }) {
  const out = [];
  let cur = [];
  let lines = 0;
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    if (cur.length && (cur.length >= maxFiles || lines + f.patch_lines > maxLines)) {
      out.push(cur);
      cur = [];
      lines = 0;
    }
    cur.push(f);
    lines += f.patch_lines;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** The task's diff, wrapped as untrusted data like reviewer-core's wrapUntrusted. */
export function wrapUntrusted(label, content) {
  const safe = content.replace(/<\s*\/?\s*untrusted\b[^>]*>/gi, (tag) => `&lt;${tag.slice(1)}`);
  return `<untrusted source="${label}">\n${safe}\n</untrusted>\n`;
}

export function runIdOf(diff) {
  return `${diff.tree.slice(0, 12)}-${diff.base_sha.slice(0, 12)}`;
}

/** Build the run plan: tasks per skill and spec, cache hits, budget, drift. */
export function plan(root, diff, { quick = false, maxTasks } = {}) {
  const { routing, source } = loadRouting(root, diff);
  const budget = { ...routing.budget };
  if (maxTasks) Object.assign(budget, { max_tasks: Number(maxTasks), max_lines: Math.max(budget.max_lines, Number(maxTasks) * budget.batch_lines) });
  const drift = driftCheck(root, routing);
  const { bySkill, unreviewed } = route(diff, routing);
  const cacheDir = join(storeDir(root), 'cache');
  const runId = runIdOf(diff);

  const tasks = [];
  const cached = [];
  const skills = [];
  const addTasks = (skill, files, extra) => {
    const hash = skillHash(root, extra.hash_of ?? skill, routing);
    const fresh = [];
    let hits = 0;
    for (const f of files) {
      const key = cacheKey(hash + (extra.spec_path ?? ''), f);
      if (existsSync(join(cacheDir, `${key}.json`))) {
        cached.push({ skill, path: f.path, key });
        hits++;
      } else fresh.push({ file: f, key });
    }
    const groups = batches(fresh.map((x) => x.file), budget);
    groups.forEach((group, i) => {
      const id = `${extra.id_prefix ?? skill}-${i + 1}`;
      tasks.push({
        id,
        skill,
        kind: extra.kind,
        origin: routing.skills[skill]?.origin ?? 'local',
        max_severity: routing.skills[skill]?.max_severity ?? 'CRITICAL',
        skill_md: extra.kind === 'skill' ? `.claude/skills/${skill}/SKILL.md` : null,
        spec_path: extra.spec_path ?? null,
        suppress: routing.skills[skill]?.suppress ?? [],
        files: group.map((f) => ({
          path: f.path,
          status: f.status,
          old_path: f.old_path,
          pure_rename: f.pure_rename,
          cache_key: fresh.find((x) => x.file === f).key,
          lines: f.patch_lines,
        })),
        lines: group.reduce((n, f) => n + f.patch_lines, 0),
        diff_path: join(runDir(root, runId), 'tasks', `${id}.diff`),
      });
    });
    skills.push({ skill, files: files.length, cached: hits, tasks: groups.length, kind: extra.kind });
  };

  for (const [skill, files] of Object.entries(bySkill)) addTasks(skill, files, { kind: 'skill' });

  const specs = linkSpecs(root, diff);
  for (const spec of specs) {
    const named = new Set(spec.files);
    let files = diff.files.filter((f) => named.has(f.path) && !f.binary && !f.generated && !f.excluded);
    if (!files.length) {
      files = diff.files.filter(
        (f) => f.path.startsWith(`${spec.pkg}/src/`) && f.status !== 'D' && !f.binary && !f.generated && !f.excluded,
      );
    }
    if (files.length) {
      addTasks(`spec:${spec.path}`, files, {
        kind: 'spec',
        spec_path: spec.path,
        hash_of: 'pr-self-review',
        id_prefix: `spec-${spec.pkg}-${spec.slug}`,
      });
    }
  }

  const lines = tasks.reduce((n, t) => n + t.lines, 0);
  const overBudget = tasks.length > budget.max_tasks || lines > budget.max_lines;
  return {
    version: 1,
    tool_version: TOOL_VERSION,
    run_id: runId,
    mode: quick ? 'quick' : 'full',
    base_ref: diff.base_ref,
    base_sha: diff.base_sha,
    head_sha: diff.head_sha,
    tree: diff.tree,
    dirty: diff.dirty,
    branch: diff.branch,
    routing_source: source,
    self_modified: isSelfModified(diff),
    drift,
    budget,
    coverage: overBudget ? 'incomplete' : 'complete',
    incomplete_reason: overBudget
      ? `${tasks.length} reviewer tasks / ${lines} diff lines exceed the budget (${budget.max_tasks} tasks / ${budget.max_lines} lines)`
      : null,
    skills,
    specs: specs.map(({ path, slug, pkg, reasons, files }) => ({ path, slug, pkg, reasons, files })),
    tasks,
    cached,
    unreviewed,
    stats: diff.stats,
  };
}

/** Write diff.json, plan.json and one wrapped diff per task. */
export function writeRun(root, diff, p) {
  const dir = runDir(root, p.run_id);
  writeJsonAtomic(join(dir, 'diff.json'), diff);
  const byPath = new Map(diff.files.map((f) => [f.path, f]));
  for (const t of p.tasks) {
    const body = t.files.map((f) => byPath.get(f.path).patch).join('\n');
    writeTextAtomic(t.diff_path, wrapUntrusted(`diff:${t.id}`, body));
  }
  writeJsonAtomic(join(dir, 'plan.json'), p);
  return dir;
}

export function summary(root, p) {
  const out = [];
  out.push(
    `run ${p.run_id} · base ${p.base_ref} @ ${p.base_sha.slice(0, 12)} · tree ${p.tree.slice(0, 12)}${p.dirty ? ' (includes uncommitted changes)' : ''} · mode ${p.mode}`,
  );
  out.push(`${p.stats.files} files · +${p.stats.added} −${p.stats.removed}`);
  if (p.drift.unrouted.length) {
    out.push(
      `DRIFT: skills with no routing decision: ${p.drift.unrouted.join(', ')} → add each to routing.json (skills or ignored) before reviewing`,
    );
  }
  if (p.drift.stale.length) out.push(`note: routing.json names skills that are gone: ${p.drift.stale.join(', ')}`);
  if (p.self_modified) {
    out.push(`SELF-MODIFIED: the diff changes the review itself (rules from ${p.routing_source}); the user must confirm the run`);
  }
  out.push('skill → files (new / cached) → reviewer tasks');
  for (const s of p.skills) out.push(`  ${s.skill}: ${s.files} (${s.files - s.cached} / ${s.cached}) → ${s.tasks}`);
  if (!p.skills.length) out.push('  (no skill matches any changed file)');
  for (const s of p.specs) out.push(`spec ${s.path}: ${s.reasons.join('; ')}`);
  if (p.unreviewed.length) {
    const shown = p.unreviewed.slice(0, 12).join(', ');
    out.push(`not reviewed by any skill (${p.unreviewed.length}): ${shown}${p.unreviewed.length > 12 ? ', …' : ''}`);
  }
  const lines = p.tasks.reduce((n, t) => n + t.lines, 0);
  out.push(
    `budget: ${p.tasks.length}/${p.budget.max_tasks} tasks, ${lines}/${p.budget.max_lines} lines → coverage ${p.coverage}`,
  );
  if (p.incomplete_reason) out.push(`INCOMPLETE: ${p.incomplete_reason}. Split the PR or rerun with --budget <tasks>.`);
  return out.join('\n');
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2), { booleans: ['summary', 'quick', 'json'] });
  const root = repoRoot();
  const diff = collectDiff(root, { base: args.base });
  const p = plan(root, diff, { quick: args.quick, maxTasks: args.budget });
  if (args.summary) {
    console.log(summary(root, p));
  } else {
    const dir = writeRun(root, diff, p);
    console.log(summary(root, p));
    console.log(`plan: ${relative(root, join(dir, 'plan.json')) || join(dir, 'plan.json')}`);
    if (args.json) {
      console.log(
        JSON.stringify(
          p.tasks.map(({ id, skill, kind, files, lines, diff_path, spec_path }) => ({
            id,
            skill,
            kind,
            files: files.map((f) => f.path),
            lines,
            diff_path,
            spec_path,
          })),
          null,
          1,
        ),
      );
    }
  }
}
