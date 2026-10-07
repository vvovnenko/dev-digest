#!/usr/bin/env node
// Collects a run's findings and decides the verdict.
//
//   record     --run <id> --task <task>   stdin: {"findings":[…]} from one reviewer
//   candidates --run <id>                 CRITICALs that still need a verifier (JSON)
//   verify     --run <id>                 stdin: [{"id","outcome","severity?","reason"}]
//   metrics    --run <id>                 stdin: [{"task","tokens","ms"}]
//   finalize   --run <id> [--confirm-self-change] [--allow-incomplete]
//   waive      --id <finding> --reason "<why>" [--run <id>]
//   show       [--run <id>]
//
// finalize refuses when the working copy changed since the run started (the
// fingerprint would no longer match what was reviewed), grounds every model
// finding in the diff's added lines, caps third-party skills, applies verifier
// outcomes and waivers, and writes <store>/verdicts/<tree>.json atomically.
// A CRITICAL nobody verified stays blocking: the gate fails closed.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  CATEGORIES,
  SEVERITIES,
  TOOL_VERSION,
  appendJsonl,
  branchKey,
  currentBranch,
  fail,
  intersects,
  isMain,
  parseArgs,
  readJson,
  readStdin,
  repoRoot,
  runDir,
  sha256,
  storeDir,
  verdictPath,
  worktreeTree,
  writeJsonAtomic,
} from './lib.mjs';

const RANK = { CRITICAL: 3, WARNING: 2, SUGGESTION: 1 };

// ---------------------------------------------------------------- loading

function loadRun(root, runId) {
  const dir = runDir(root, runId);
  if (!existsSync(join(dir, 'plan.json'))) fail(`no run ${runId} — start with select-skills.mjs`);
  return {
    dir,
    plan: readJson(join(dir, 'plan.json')),
    diff: readJson(join(dir, 'diff.json')),
    checks: readJson(join(dir, 'checks.json'), null),
    verifications: readJson(join(dir, 'verifications.json'), {}),
    metrics: readJson(join(dir, 'metrics.json'), {}),
  };
}

const findingId = (skill, f) => `f-${sha256([skill, f.rule_id, f.file, f.title].join('|')).slice(0, 10)}`;

// ---------------------------------------------------------------- record

/** Validate one reviewer's JSON; throws with every problem listed. */
export function normalizeFindings(task, input) {
  const list = Array.isArray(input) ? input : input?.findings;
  if (!Array.isArray(list)) throw new Error('expected {"findings": [...]} or an array');
  const files = new Set(task.files.map((f) => f.path));
  const problems = [];
  const seen = new Map();
  const out = list.map((raw, i) => {
    const where = `findings[${i}]`;
    const f = { ...raw };
    f.severity = String(f.severity ?? '').toUpperCase();
    if (!SEVERITIES.includes(f.severity)) problems.push(`${where}.severity must be one of ${SEVERITIES.join(', ')}`);
    if (!CATEGORIES.includes(f.category)) problems.push(`${where}.category must be one of ${CATEGORIES.join(', ')}`);
    for (const k of ['title', 'file', 'rationale']) if (typeof f[k] !== 'string' || !f[k].trim()) problems.push(`${where}.${k} must be a non-empty string`);
    if (typeof f.file === 'string' && !files.has(f.file)) problems.push(`${where}.file "${f.file}" is not one of this task's files`);
    f.start_line = Number(f.start_line);
    f.end_line = f.end_line === undefined || f.end_line === null ? f.start_line : Number(f.end_line);
    if (!Number.isInteger(f.start_line) || f.start_line < 1) problems.push(`${where}.start_line must be a positive integer (a new-side line number)`);
    if (!Number.isInteger(f.end_line) || f.end_line < f.start_line) problems.push(`${where}.end_line must be an integer ≥ start_line`);
    if (typeof f.rule_id !== 'string' || !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(f.rule_id)) problems.push(`${where}.rule_id must look like "onion/route-no-sql"`);
    f.confidence = f.confidence === undefined ? 0.7 : Number(f.confidence);
    if (!(f.confidence >= 0 && f.confidence <= 1)) problems.push(`${where}.confidence must be between 0 and 1`);
    if (typeof f.introduced !== 'boolean') problems.push(`${where}.introduced must be true (this diff adds it) or false (it was already there)`);
    f.suggestion = typeof f.suggestion === 'string' && f.suggestion.trim() ? f.suggestion : null;
    let id = findingId(task.skill, f);
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    if (n > 1) id = `${id}-${n}`;
    return {
      id,
      source: 'model',
      skill: task.skill,
      task: task.id,
      origin: task.origin,
      severity: f.severity,
      category: f.category,
      rule_id: f.rule_id,
      title: f.title,
      file: f.file,
      start_line: f.start_line,
      end_line: f.end_line,
      rationale: f.rationale,
      suggestion: f.suggestion,
      confidence: f.confidence,
      introduced: f.introduced,
      waivable: true,
    };
  });
  if (problems.length) throw new Error(problems.join('\n'));
  return out;
}

function record(root, args) {
  const run = loadRun(root, args.run);
  const task = run.plan.tasks.find((t) => t.id === args.task);
  if (!task) fail(`run ${args.run} has no task ${args.task}`);
  let input;
  try {
    input = JSON.parse(readStdin());
  } catch (e) {
    fail(`stdin is not valid JSON: ${e.message}`);
  }
  let findings;
  try {
    findings = normalizeFindings(task, input);
  } catch (e) {
    fail(`rejected — fix and record again:\n${e.message}`);
  }
  const files = new Map(run.diff.files.map((f) => [f.path, f]));
  for (const f of findings) {
    const file = files.get(f.file);
    if (file && !intersects(file.added, f.start_line, f.end_line) && !(file.pure_rename && f.start_line === 1)) {
      console.log(`warning: ${f.id} ${f.file}:${f.start_line}-${f.end_line} is not on an added line — grounding will drop it (added: ${file.added.map(([a, b]) => (a === b ? a : `${a}-${b}`)).join(', ') || 'none'})`);
    }
  }
  writeJsonAtomic(join(run.dir, 'findings', `${task.id}.json`), {
    task: task.id,
    skill: task.skill,
    recorded_at: new Date().toISOString(),
    notes: typeof input?.notes === 'string' ? input.notes : null,
    findings,
  });
  const by = SEVERITIES.map((s) => `${findings.filter((f) => f.severity === s).length} ${s}`).join(' · ');
  console.log(`recorded ${task.id}: ${by}`);
}

// ---------------------------------------------------------------- shaping

/** Ground, cap and mark a run's findings; returns kept + dropped. */
export function shape(run) {
  const files = new Map(run.diff.files.map((f) => [f.path, f]));
  const tasks = new Map(run.plan.tasks.map((t) => [t.id, t]));
  const kept = [];
  const dropped = [];
  const raw = [];
  const findingsDir = join(run.dir, 'findings');
  if (existsSync(findingsDir)) {
    for (const name of readdirSync(findingsDir)) raw.push(...readJson(join(findingsDir, name)).findings);
  }
  for (const c of run.plan.cached ?? []) {
    const entry = readJson(join(run.cacheDir, `${c.key}.json`), null);
    if (entry) raw.push(...entry.findings.map((f) => ({ ...f, cached: true })));
  }
  for (const f0 of raw) {
    const f = { ...f0 };
    const file = files.get(f.file);
    const task = tasks.get(f.task);
    const renameOk = file?.pure_rename && f.start_line === 1 && (f.cached || (task?.files ?? []).some((x) => x.path === f.file));
    if (!file || (!intersects(file.added, f.start_line, f.end_line) && !renameOk)) {
      dropped.push({ ...f, dropped: 'its lines are not added by this diff (grounding)' });
      continue;
    }
    if (f.origin === 'third-party' && f.severity === 'CRITICAL' && !['bug', 'security'].includes(f.category)) {
      f.severity = 'WARNING';
      f.capped = 'third-party skills raise CRITICAL only for a bug or a vulnerability';
    }
    const max = task?.max_severity ?? 'CRITICAL';
    if (RANK[f.severity] > RANK[max]) {
      f.severity = max;
      f.capped = `${f.skill} findings are capped at ${max}`;
    }
    if (f.introduced === false) f.pre_existing = true;
    if (f.severity === 'CRITICAL' && !f.pre_existing) f.needs_verification = f.verification ? false : true;
    kept.push(f);
  }
  for (const c of run.checks?.findings ?? []) kept.push({ ...c, skill: `check ${c.check}` });
  return { kept: dedupe(kept), dropped };
}

/**
 * Several lenses often report one problem (a missing workspace scope seen by
 * onion, security and fastify). Keep one per rule_id + file + overlapping lines —
 * a local skill's over a third-party one, then the higher severity and confidence —
 * and list the others in `also_from`, so the problem is verified and waived once.
 */
export function dedupe(findings) {
  const rank = (f) => [f.origin === 'local' ? 1 : 0, RANK[f.severity] ?? 0, f.confidence ?? 0];
  const better = (a, b) => {
    const [x, y] = [rank(a), rank(b)];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i];
    return false;
  };
  const out = [];
  for (const f of findings) {
    const twin = out.find(
      (g) =>
        g.source === 'model' &&
        f.source === 'model' &&
        g.rule_id === f.rule_id &&
        g.file === f.file &&
        f.start_line <= g.end_line &&
        f.end_line >= g.start_line,
    );
    if (!twin) {
      out.push({ ...f });
      continue;
    }
    const [keep, other] = better(f, twin) ? [{ ...f }, twin] : [twin, f];
    keep.also_from = [...new Set([...(keep.also_from ?? []), ...(other.also_from ?? []), other.skill])].filter((s) => s !== keep.skill);
    out[out.indexOf(twin)] = keep;
  }
  return out;
}

function applyVerifications(kept, verifications) {
  const out = [];
  const rejected = [];
  for (const f0 of kept) {
    const f = { ...f0 };
    const v = verifications[f.id] ?? f.verification ?? null;
    if (v?.outcome === 'rejected') {
      f.verification = v;
      rejected.push(f);
      continue;
    }
    if (v?.outcome === 'downgraded' && f.severity === 'CRITICAL') {
      f.severity = SEVERITIES.includes(v.severity) && v.severity !== 'CRITICAL' ? v.severity : 'WARNING';
    }
    if (v) f.verification = v;
    else if (f.severity === 'CRITICAL' && !f.pre_existing && (f.source === 'model' || f.needs_verification)) {
      f.verification = { outcome: 'missing' };
    }
    out.push(f);
  }
  return { findings: out, rejected };
}

function waiversFile(root, branch) {
  return join(storeDir(root), `waivers-${branchKey(branch)}.json`);
}

function applyWaivers(findings, waivers) {
  for (const f of findings) {
    if (f.severity !== 'CRITICAL' || f.pre_existing || !f.waivable) continue;
    const w = waivers.find((x) => x.rule_id === f.rule_id && x.file === f.file);
    if (w) f.waived = { reason: w.reason, at: w.at };
  }
}

export const isBlocking = (f) => f.severity === 'CRITICAL' && !f.pre_existing && !f.waived;

function decide(v) {
  const reasons = [];
  const blocking = v.findings.filter(isBlocking);
  if (blocking.length) reasons.push(`${blocking.length} CRITICAL`);
  const incomplete = [];
  if (v.coverage !== 'complete') incomplete.push(v.incomplete_reason ?? 'not every file was reviewed');
  for (const c of v.checks.filter((c) => c.status === 'error')) incomplete.push(`check ${c.id} could not run`);
  if (v.drift?.unrouted?.length) incomplete.push(`unrouted skills: ${v.drift.unrouted.join(', ')}`);
  if (v.self_modified && !v.self_change_confirmed) incomplete.push('the diff changes the review itself and the user has not confirmed the run');
  if (blocking.length) return { status: 'BLOCKED', reasons: [...reasons, ...incomplete] };
  if (incomplete.length) return { status: 'INCOMPLETE', reasons: incomplete };
  return { status: 'PASS', reasons: [] };
}

function counts(findings) {
  const c = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0, blocking: 0, waived: 0, pre_existing: 0 };
  for (const f of findings) {
    c[f.severity]++;
    if (isBlocking(f)) c.blocking++;
    if (f.waived) c.waived++;
    if (f.pre_existing) c.pre_existing++;
  }
  return c;
}

// ---------------------------------------------------------------- finalize

function finalize(root, args) {
  const run = loadRun(root, args.run);
  run.cacheDir = join(storeDir(root), 'cache');
  const { plan } = run;
  if (!run.checks) fail(`no checks.json for run ${plan.run_id} — run checks.mjs --run ${plan.run_id} first`);
  const now = worktreeTree(root).tree;
  if (now !== plan.tree) {
    fail(`the working copy changed since this run started (reviewed ${plan.tree.slice(0, 12)}, now ${now.slice(0, 12)}) — rerun /pr-self-review`);
  }
  const missing = plan.tasks.filter((t) => !existsSync(join(run.dir, 'findings', `${t.id}.json`))).map((t) => t.id);
  if (missing.length && !args['allow-incomplete']) fail(`no findings recorded for: ${missing.join(', ')} (or pass --allow-incomplete)`);

  const { kept, dropped } = shape(run);
  const { findings, rejected } = applyVerifications(kept, run.verifications);
  const branch = plan.branch ?? currentBranch(root);
  const waivers = readJson(waiversFile(root, branch), []);
  applyWaivers(findings, waivers);

  // Cache what reviewers said per (skill, file), with verifier outcomes, so an
  // unchanged file is not reviewed again on the next run.
  for (const t of plan.tasks) {
    if (missing.includes(t.id)) continue;
    for (const file of t.files) {
      const mine = [...findings, ...rejected]
        .filter((f) => f.task === t.id && f.file === file.path && !f.cached)
        .map(({ waived, needs_verification, ...f }) => ({ ...f, verification: run.verifications[f.id] ?? f.verification ?? null }));
      writeJsonAtomic(join(run.cacheDir, `${file.cache_key}.json`), { skill: t.skill, path: file.path, findings: mine });
    }
  }

  const verdict = {
    version: 1,
    tool_version: TOOL_VERSION,
    run_id: plan.run_id,
    tree: plan.tree,
    base_ref: plan.base_ref,
    base_sha: plan.base_sha,
    head_sha: plan.head_sha,
    dirty: plan.dirty,
    branch,
    mode: plan.mode === 'quick' || run.checks.mode !== 'full' ? 'quick' : 'full',
    created_at: new Date().toISOString(),
    coverage: missing.length ? 'incomplete' : plan.coverage,
    incomplete_reason: missing.length ? `no findings recorded for ${missing.join(', ')}` : plan.incomplete_reason,
    self_modified: plan.self_modified,
    self_change_confirmed: Boolean(args['confirm-self-change']),
    drift: plan.drift,
    skills_run: plan.skills,
    specs: plan.specs,
    unreviewed_files: plan.unreviewed,
    checks: run.checks.checks.map(({ findings: _f, ...c }) => c),
    findings: findings.sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.file.localeCompare(b.file) || (a.start_line ?? 0) - (b.start_line ?? 0)),
    dropped,
    rejected,
    metrics: buildMetrics(run),
  };
  Object.assign(verdict, decide(verdict));
  verdict.counts = counts(verdict.findings);

  recordFeedback(root, verdict, branch);
  writeJsonAtomic(verdictPath(root, plan.tree), verdict);
  writeJsonAtomic(join(storeDir(root), `latest-${branchKey(branch)}.json`), { tree: plan.tree, run_id: plan.run_id, at: verdict.created_at });
  console.log(renderReport(verdict));
}

function buildMetrics(run) {
  const reviewers = run.plan.tasks.map((t) => ({
    task: t.id,
    skill: t.skill,
    files: t.files.length,
    lines: t.lines,
    tokens: run.metrics.tasks?.[t.id]?.tokens ?? null,
    ms: run.metrics.tasks?.[t.id]?.ms ?? null,
  }));
  const sum = (k) => reviewers.reduce((n, r) => n + (r[k] ?? 0), 0);
  return {
    checks_ms: run.checks?.ms ?? null,
    checks: Object.fromEntries((run.checks?.checks ?? []).map((c) => [c.id, c.ms])),
    reviewers,
    reviewer_tokens: sum('tokens'),
    reviewer_ms: sum('ms'),
    cache_hits: (run.plan.cached ?? []).length,
    devdigest_cost_usd: run.metrics.devdigest_cost_usd ?? null,
  };
}

/** feedback.jsonl: what happened to each finding, for --stats. */
function recordFeedback(root, verdict, branch) {
  const path = join(storeDir(root), 'feedback.jsonl');
  const at = verdict.created_at;
  const row = (f, outcome) => ({ at, branch, id: f.id, skill: f.skill, rule_id: f.rule_id, file: f.file, severity: f.severity, outcome });
  const rows = verdict.rejected.filter((f) => !f.cached).map((f) => row(f, 'rejected_by_verifier'));
  const latest = readJson(join(storeDir(root), `latest-${branchKey(branch)}.json`), null);
  const previous = latest && latest.tree !== verdict.tree ? readJson(verdictPath(root, latest.tree), null) : null;
  if (previous && previous.base_sha === verdict.base_sha) {
    const now = new Set(verdict.findings.map((f) => f.id));
    for (const f of previous.findings) {
      if (f.source === 'model' && ['CRITICAL', 'WARNING'].includes(f.severity) && !f.pre_existing && !now.has(f.id)) rows.push(row(f, 'fixed'));
    }
  }
  if (verdict.status === 'PASS') {
    for (const f of verdict.findings) if (f.source === 'model' && f.severity === 'WARNING' && !f.pre_existing) rows.push(row(f, 'ignored'));
  }
  appendJsonl(path, rows);
}

// ---------------------------------------------------------------- waive

function latestVerdict(root, runId) {
  if (runId) {
    const plan = readJson(join(runDir(root, runId), 'plan.json'));
    return { path: verdictPath(root, plan.tree), verdict: readJson(verdictPath(root, plan.tree)) };
  }
  const branch = currentBranch(root);
  const latest = readJson(join(storeDir(root), `latest-${branchKey(branch)}.json`), null);
  if (!latest) fail(`no verdict yet for branch ${branch} — run /pr-self-review`);
  return { path: verdictPath(root, latest.tree), verdict: readJson(verdictPath(root, latest.tree)) };
}

function waive(root, args) {
  const { path, verdict } = latestVerdict(root, args.run);
  const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
  if (reason.length < 10) fail('a waiver needs the user\'s reason (--reason "…", at least 10 characters)');
  const f = verdict.findings.find((x) => x.id === args.id || x.id.startsWith(String(args.id)));
  if (!f) fail(`no finding ${args.id} in the verdict for ${verdict.tree.slice(0, 12)}`);
  if (f.severity !== 'CRITICAL' || f.pre_existing) fail(`${f.id} is not a blocking CRITICAL`);
  if (!f.waivable) fail(`${f.id} (${f.rule_id}) can't be waived: CI fails on it anyway, or a key has already leaked — fix it`);
  const at = new Date().toISOString();
  const file = waiversFile(root, verdict.branch);
  const waivers = readJson(file, []).filter((w) => !(w.rule_id === f.rule_id && w.file === f.file));
  waivers.push({ rule_id: f.rule_id, file: f.file, title: f.title, reason, at, finding_id: f.id });
  writeJsonAtomic(file, waivers);
  f.waived = { reason, at };
  Object.assign(verdict, decide(verdict));
  verdict.counts = counts(verdict.findings);
  writeJsonAtomic(path, verdict);
  appendJsonl(join(storeDir(root), 'feedback.jsonl'), [
    { at, branch: verdict.branch, id: f.id, skill: f.skill, rule_id: f.rule_id, file: f.file, severity: 'CRITICAL', outcome: 'waived', reason },
  ]);
  console.log(renderReport(verdict));
}

// ---------------------------------------------------------------- report

const loc = (f) => (f.start_line ? `${f.file}:${f.start_line}${f.end_line && f.end_line !== f.start_line ? `-${f.end_line}` : ''}` : f.file);

export function renderReport(v) {
  const c = v.counts;
  const out = [];
  out.push(`## PR self-review — ${v.status} (${c.CRITICAL} CRITICAL · ${c.WARNING} WARNING · ${c.SUGGESTION} SUGGESTION)`);
  out.push('');
  out.push(
    `base \`${v.base_ref}\` @ \`${v.base_sha.slice(0, 12)}\` · tree \`${v.tree.slice(0, 12)}\`${v.dirty ? ' (uncommitted changes included)' : ''} · mode ${v.mode} · run \`${v.run_id}\``,
  );
  for (const r of v.reasons) out.push(`- ${r}`);
  out.push('');
  out.push('| Skill | Files | Cached | Tasks |');
  out.push('| --- | --- | --- | --- |');
  for (const s of v.skills_run) out.push(`| ${s.skill} | ${s.files} | ${s.cached} | ${s.tasks} |`);
  for (const sev of ['CRITICAL', 'WARNING', 'SUGGESTION']) {
    const list = v.findings.filter((f) => f.severity === sev);
    if (!list.length) continue;
    out.push('', `### ${sev} (${list.length})`);
    for (const f of list) {
      const tags = [
        f.pre_existing && 'pre-existing, not blocking',
        f.waived && `waived: ${f.waived.reason}`,
        f.verification?.outcome === 'missing' && 'NOT VERIFIED',
        f.verification?.outcome === 'confirmed' && 'verified',
        f.capped && `capped: ${f.capped}`,
        f.cached && 'cached',
        f.also_from?.length && `also: ${f.also_from.join(', ')}`,
      ].filter(Boolean);
      out.push(`- \`${f.id}\` \`${loc(f)}\` **${f.title}** — \`${f.rule_id}\` · ${f.skill}${tags.length ? ` · _${tags.join('; ')}_` : ''}`);
      if (sev !== 'SUGGESTION') {
        out.push(`  ${f.rationale.split('\n').slice(0, 6).join('\n  ')}`);
        if (f.suggestion) out.push(`  → ${f.suggestion}`);
      }
    }
  }
  if (v.rejected?.length) out.push('', `_${v.rejected.length} CRITICAL(s) rejected by the verifier (not shown)._`);
  if (v.dropped?.length) out.push(`_${v.dropped.length} finding(s) dropped by grounding: their lines are not in the diff._`);
  out.push('', '### Checks');
  for (const ch of v.checks) out.push(`- ${ch.status.toUpperCase().padEnd(5)} ${ch.id} ${ch.title}${ch.notes?.length ? ` — ${ch.notes[0].split('\n')[0]}` : ''}`);
  if (v.unreviewed_files?.length) {
    out.push('', `### Not reviewed by any skill (${v.unreviewed_files.length})`);
    out.push(v.unreviewed_files.slice(0, 30).map((p) => `\`${p}\``).join(', ') + (v.unreviewed_files.length > 30 ? ', …' : ''));
  }
  const m = v.metrics;
  const secs = (ms) => (ms ? `${(ms / 1000).toFixed(1)} s` : '—');
  out.push(
    '',
    `_Metrics: checks ${secs(m.checks_ms)} · reviewers ${m.reviewers.length} (${secs(m.reviewer_ms)}, ${m.reviewer_tokens || '—'} tokens) · cache hits ${m.cache_hits}${m.devdigest_cost_usd !== null ? ` · DevDigest $${m.devdigest_cost_usd.toFixed(4)}` : ''}_`,
  );
  if (v.status === 'BLOCKED') out.push('', 'Push and PR creation are blocked for this tree. Fix the CRITICALs (`/pr-self-review --fix`), or waive a false positive with the user\'s reason (`--waive <id> "<reason>"`).');
  if (v.status === 'INCOMPLETE') out.push('', 'Not a PASS: the gate refuses until the run is complete.');
  return out.join('\n');
}

// ---------------------------------------------------------------- cli

function stdinJson() {
  try {
    return JSON.parse(readStdin());
  } catch (e) {
    return fail(`stdin is not valid JSON: ${e.message}`);
  }
}

if (isMain(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest, { booleans: ['confirm-self-change', 'allow-incomplete'] });
  const root = repoRoot();
  const needRun = () => args.run || fail(`${cmd} needs --run <id>`);
  switch (cmd) {
    case 'record':
      needRun();
      if (!args.task) fail('record needs --task <task-id>');
      record(root, args);
      break;
    case 'candidates': {
      const run = loadRun(root, needRun());
      run.cacheDir = join(storeDir(root), 'cache');
      const { kept } = shape(run);
      const list = kept
        .filter((f) => f.severity === 'CRITICAL' && !f.pre_existing && f.needs_verification && !f.verification && !run.verifications[f.id])
        .map(({ id, skill, rule_id, file, start_line, end_line, title, rationale, suggestion, category, task }) => ({ id, skill, task, rule_id, category, file, start_line, end_line, title, rationale, suggestion }));
      console.log(JSON.stringify(list, null, 1));
      break;
    }
    case 'verify': {
      const run = loadRun(root, needRun());
      const input = stdinJson();
      const list = Array.isArray(input) ? input : [input];
      for (const v of list) {
        if (!v?.id || !['confirmed', 'downgraded', 'rejected'].includes(v.outcome) || typeof v.reason !== 'string') {
          fail('each verification needs {"id", "outcome": confirmed|downgraded|rejected, "reason"}');
        }
        run.verifications[v.id] = { outcome: v.outcome, severity: v.severity ?? null, reason: v.reason };
      }
      writeJsonAtomic(join(run.dir, 'verifications.json'), run.verifications);
      console.log(`recorded ${list.length} verification(s)`);
      break;
    }
    case 'metrics': {
      const run = loadRun(root, needRun());
      const input = stdinJson();
      run.metrics.tasks ??= {};
      for (const m of Array.isArray(input) ? input : [input]) {
        if (m.task) run.metrics.tasks[m.task] = { tokens: m.tokens ?? null, ms: m.ms ?? null };
        if (m.devdigest_cost_usd !== undefined) run.metrics.devdigest_cost_usd = m.devdigest_cost_usd;
      }
      writeJsonAtomic(join(run.dir, 'metrics.json'), run.metrics);
      console.log('metrics recorded');
      break;
    }
    case 'finalize':
      needRun();
      finalize(root, args);
      break;
    case 'waive':
      if (!args.id) fail('waive needs --id <finding-id> --reason "<why>"');
      waive(root, args);
      break;
    case 'show':
      console.log(renderReport(latestVerdict(root, args.run).verdict));
      break;
    default:
      process.stderr.write('usage: verdict.mjs record|candidates|verify|metrics|finalize|waive|show …\n');
      process.exit(2);
  }
}
