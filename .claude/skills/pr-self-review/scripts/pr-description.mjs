#!/usr/bin/env node
// A ready PR description from a finished self-review, plus the GitHub compare
// URL that opens the "New pull request" form (gh isn't installed here).
//
//   node pr-description.mjs [--run <id>] [--title "<title>"] [--summary "<markdown>"] [--copy]
//
// Facts come from the verdict and the run (packages, risks, checks, tests,
// self-review table, waivers, specs); the title and summary are passed in by
// the agent that read the change, else derived from the commits. Writes
// <git-common-dir>/pr-self-review/<tree>.pr.md; --copy also puts it on the
// clipboard (pbcopy).

import { spawnSync } from 'node:child_process';
import { join, posix } from 'node:path';
import {
  branchKey,
  currentBranch,
  fail,
  gitTry,
  isMain,
  matchAny,
  parseArgs,
  readJson,
  repoRoot,
  runDir,
  storeDir,
  verdictPath,
  writeTextAtomic,
} from './lib.mjs';

const ATTRIBUTION = '🤖 Generated with [Claude Code](https://claude.com/claude-code)';

export function githubRepo(root) {
  const url = gitTry(['remote', 'get-url', 'origin'], { cwd: root }) ?? '';
  const m = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(url);
  return m ? { owner: m[1], repo: m[2] } : null;
}

function defaultTitle(diff) {
  const subjects = diff.commits.filter((c) => !c.merge).map((c) => c.subject);
  if (subjects.length === 1) return subjects[0];
  const conv = subjects.map((s) => /^(\w+)(?:\(([^)]+)\))?!?: /.exec(s)).filter(Boolean);
  if (!conv.length) return (diff.branch ?? 'changes').replace(/[-_/]+/g, ' ');
  const type = conv.some((m) => m[1] === 'feat') ? 'feat' : conv.some((m) => m[1] === 'fix') ? 'fix' : conv[0][1];
  const scopes = [...new Set(conv.map((m) => m[2]).filter(Boolean))];
  return `${type}${scopes.length && scopes.length <= 3 ? `(${scopes.join(', ')})` : ''}: ${(diff.branch ?? '').replace(/^[^/]*\//, '').replace(/[-_]+/g, ' ') || subjects[0]}`;
}

export function buildDescription(v, diff, { title, summary } = {}) {
  const out = [];
  const files = diff.files.filter((f) => !f.excluded);
  const pkgOf = (p) => (['client', 'server', 'reviewer-core', 'e2e'].includes(p.split('/')[0]) ? `${p.split('/')[0]}/` : p.startsWith('.claude/') ? '.claude/' : 'repo root, docs, CI');
  const byPkg = new Map();
  for (const f of files) {
    const k = pkgOf(f.path);
    const e = byPkg.get(k) ?? { n: 0, add: 0, del: 0 };
    e.n++;
    e.add += f.added_count;
    e.del += f.removed_count;
    byPkg.set(k, e);
  }

  out.push('## Summary', '');
  if (summary) out.push(summary.trim());
  else for (const c of diff.commits.filter((x) => !x.merge).slice(0, 12)) out.push(`- ${c.subject}`);

  out.push('', '## Changes by package', '');
  for (const [k, e] of [...byPkg].sort((a, b) => b[1].n - a[1].n)) out.push(`- **${k}** — ${e.n} file(s), +${e.add} −${e.del}`);

  const risks = [];
  if (files.some((f) => matchAny(f.path, ['server/src/vendor/shared/**']))) risks.push('Contract change in `@devdigest/shared` (the client mirror is checked by D4).');
  const migrations = files.filter((f) => /^server\/src\/db\/migrations\/\d{4}_.+\.sql$/.test(f.path) && f.status === 'A');
  if (migrations.length) risks.push(`New migration(s): ${migrations.map((f) => `\`${posix.basename(f.path)}\``).join(', ')} — run \`cd server && pnpm db:migrate\`.`);
  if (files.some((f) => ['pnpm-lock.yaml', 'package-lock.json'].includes(posix.basename(f.path)))) risks.push('Dependencies changed — reinstall in the affected packages.');
  for (const f of v.findings.filter((x) => x.waived)) risks.push(`Waived CRITICAL \`${f.rule_id}\` in \`${f.file}\` — ${f.waived.reason}`);
  const pre = v.findings.filter((f) => f.pre_existing).length;
  if (pre) risks.push(`${pre} pre-existing issue(s) noted by the review, not introduced here.`);
  if (risks.length) out.push('', '## Risks', '', ...risks.map((r) => `- ${r}`));

  out.push('', '## Testing', '');
  for (const c of v.checks.filter((x) => x.status !== 'skip')) {
    const note = (c.notes ?? []).filter((n) => /ok|exit/.test(n)).join('; ');
    out.push(`- ${c.id} ${c.title}: ${c.status}${note ? ` (${note})` : ''}`);
  }
  const tests = files.filter((f) => /\.test\.(ts|tsx|mts)$/.test(f.path) || f.path.endsWith('.flow.json'));
  if (tests.length) out.push(`- Tests added or changed: ${tests.slice(0, 15).map((f) => `\`${f.path}\``).join(', ')}${tests.length > 15 ? ', …' : ''}`);

  out.push('', '## Self-review', '');
  const c = v.counts;
  out.push(`\`/pr-self-review\` → **${v.status}** · ${c.CRITICAL} CRITICAL (${c.blocking} blocking, ${c.waived} waived) · ${c.WARNING} WARNING · ${c.SUGGESTION} SUGGESTION · tree \`${v.tree.slice(0, 12)}\``, '');
  out.push('| Skill | Files | Findings |', '| --- | --- | --- |');
  for (const s of v.skills_run) {
    const n = v.findings.filter((f) => f.skill === s.skill).length;
    out.push(`| ${s.skill} | ${s.files} | ${n} |`);
  }
  if (v.specs?.length) out.push('', `Specs: ${v.specs.map((s) => `\`${s.path}\``).join(', ')}`);
  out.push('', ATTRIBUTION, '');
  return { title: title || defaultTitle(diff), body: out.join('\n') };
}

export function compareUrl(root, v, title) {
  const gh = githubRepo(root);
  if (!gh || !v.branch || v.branch === 'HEAD') return null;
  const base = v.base_ref.replace(/^[^/]+\//, '');
  return `https://github.com/${gh.owner}/${gh.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(v.branch)}?expand=1&title=${encodeURIComponent(title)}`;
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2), { booleans: ['copy'] });
  const root = repoRoot();
  let tree;
  let runId = args.run;
  if (runId) tree = readJson(join(runDir(root, runId), 'plan.json')).tree;
  else {
    const latest = readJson(join(storeDir(root), `latest-${branchKey(currentBranch(root))}.json`), null);
    if (!latest) fail('no verdict for this branch yet — run /pr-self-review');
    ({ tree, run_id: runId } = latest);
  }
  const v = readJson(verdictPath(root, tree));
  const diff = readJson(join(runDir(root, runId), 'diff.json'));
  const { title, body } = buildDescription(v, diff, { title: args.title, summary: args.summary });
  const path = join(storeDir(root), `${tree}.pr.md`);
  writeTextAtomic(path, `# ${title}\n\n${body}`);
  if (v.status !== 'PASS') console.log(`note: the verdict is ${v.status} — this is a draft; the gate refuses the push until it is PASS.\n`);
  console.log(`# ${title}\n\n${body}`);
  console.log(`saved: ${path}`);
  const url = compareUrl(root, v, title);
  if (url) console.log(`open the PR: ${url}`);
  if (args.copy) {
    const r = spawnSync('pbcopy', { input: body });
    console.log(r.status === 0 ? 'body copied to the clipboard' : 'pbcopy is not available — copy the body from the file above');
  }
}
