#!/usr/bin/env node
// How well the self-review's rules do: precision per rule_id and skill, and
// what each reviewer costs.
//
//   node stats.mjs [--branch <name>] [--min <n>] [--json]
//
// feedback.jsonl records what happened to each finding: `fixed` (it was real),
// `waived` (the user overrode it), `rejected_by_verifier`, `ignored` (a WARNING
// left in a PASS). The last outcome per finding counts. A rule with at least
// --min outcomes (default 5) and precision under 50% gets a proposed demotion
// to WARNING in references/severity.md — shown, never applied.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isMain, parseArgs, readJson, readJsonl, repoRoot, storeDir } from './lib.mjs';

export function aggregate(rows, { min = 5 } = {}) {
  const last = new Map();
  for (const r of rows) last.set(`${r.branch}|${r.id}`, r);
  const byRule = new Map();
  for (const r of last.values()) {
    const e = byRule.get(r.rule_id) ?? { rule_id: r.rule_id, skill: r.skill, n: 0, fixed: 0, waived: 0, rejected_by_verifier: 0, ignored: 0, critical: 0 };
    e.n++;
    e[r.outcome] = (e[r.outcome] ?? 0) + 1;
    if (r.severity === 'CRITICAL') e.critical++;
    byRule.set(r.rule_id, e);
  }
  const rules = [...byRule.values()].map((e) => ({ ...e, precision: e.n ? e.fixed / e.n : null }));
  rules.sort((a, b) => b.n - a.n);
  const proposals = rules
    .filter((e) => e.n >= min && e.precision < 0.5 && e.critical > 0)
    .map((e) => `Consider demoting \`${e.rule_id}\` (${e.skill}) to WARNING in references/severity.md: ${e.fixed}/${e.n} fixed (${Math.round(e.precision * 100)}%), ${e.waived} waived, ${e.rejected_by_verifier} rejected by the verifier.`);
  return { rules, proposals };
}

export function reviewerCosts(root) {
  const dir = join(storeDir(root), 'verdicts');
  if (!existsSync(dir)) return [];
  const bySkill = new Map();
  for (const name of readdirSync(dir)) {
    const v = readJson(join(dir, name), null);
    for (const r of v?.metrics?.reviewers ?? []) {
      const e = bySkill.get(r.skill) ?? { skill: r.skill, runs: 0, ms: 0, tokens: 0, files: 0 };
      e.runs++;
      e.ms += r.ms ?? 0;
      e.tokens += r.tokens ?? 0;
      e.files += r.files ?? 0;
      bySkill.set(r.skill, e);
    }
  }
  return [...bySkill.values()].sort((a, b) => b.tokens - a.tokens);
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2), { booleans: ['json'] });
  const root = repoRoot();
  let rows = readJsonl(join(storeDir(root), 'feedback.jsonl'));
  if (args.branch) rows = rows.filter((r) => r.branch === args.branch);
  const { rules, proposals } = aggregate(rows, { min: Number(args.min ?? 5) });
  const costs = reviewerCosts(root);
  if (args.json) {
    console.log(JSON.stringify({ rules, proposals, costs }, null, 2));
  } else {
    if (!rules.length) console.log('no feedback yet — it accumulates as findings get fixed, waived or rejected');
    else {
      console.log('| rule_id | skill | outcomes | fixed | waived | rejected | ignored | precision |');
      console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
      for (const e of rules) {
        console.log(`| \`${e.rule_id}\` | ${e.skill} | ${e.n} | ${e.fixed} | ${e.waived} | ${e.rejected_by_verifier} | ${e.ignored} | ${e.precision === null ? '—' : `${Math.round(e.precision * 100)}%`} |`);
      }
    }
    if (costs.length) {
      console.log('\n| reviewer | tasks | avg time | avg tokens | files |');
      console.log('| --- | --- | --- | --- | --- |');
      for (const c of costs) console.log(`| ${c.skill} | ${c.runs} | ${(c.ms / c.runs / 1000).toFixed(1)} s | ${Math.round(c.tokens / c.runs)} | ${c.files} |`);
    }
    if (proposals.length) console.log(`\nProposals (not applied):\n${proposals.map((p) => `- ${p}`).join('\n')}`);
  }
}
