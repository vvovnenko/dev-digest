import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { classify, checkCommit } from '../gate.mjs';
import { readJson, storeDir } from '../lib.mjs';
import { normalizeFindings } from '../verdict.mjs';
import { commit, git, makeRepo, run, write } from './helpers.mjs';

/** The skill's pipeline without the model: plan → checks → record → verify → finalize. */
function review(root, { findings = {}, verify = [], finalizeArgs = [], selectArgs = [] } = {}) {
  const sel = run(root, 'select-skills.mjs', selectArgs);
  assert.equal(sel.code, 0, sel.stderr);
  const runId = /run (\S+)/.exec(sel.stdout)[1];
  const p = readJson(join(storeDir(root), 'runs', runId, 'plan.json'));
  const chk = run(root, 'checks.mjs', ['--run', runId]);
  assert.equal(chk.code, 0, chk.stderr);
  for (const t of p.tasks) {
    const rec = run(root, 'verdict.mjs', ['record', '--run', runId, '--task', t.id], JSON.stringify({ findings: findings[t.skill] ?? [] }));
    assert.equal(rec.code, 0, rec.stderr);
  }
  if (verify.length) {
    const cands = JSON.parse(run(root, 'verdict.mjs', ['candidates', '--run', runId]).stdout);
    const answers = verify.map((v, i) => ({ id: cands[i].id, ...v }));
    assert.equal(run(root, 'verdict.mjs', ['verify', '--run', runId], JSON.stringify(answers)).code, 0);
  }
  const fin = run(root, 'verdict.mjs', ['finalize', '--run', runId, ...finalizeArgs]);
  assert.equal(fin.code, 0, fin.stderr);
  const verdict = readJson(join(storeDir(root), 'verdicts', `${p.tree}.json`));
  return { runId, plan: p, verdict, report: fin.stdout };
}

const crit = (file, line, extra = {}) => ({
  severity: 'CRITICAL',
  category: 'bug',
  rule_id: 'onion/route-no-sql',
  title: 'Route queries the database',
  file,
  start_line: line,
  end_line: line,
  rationale: 'routes call services',
  introduced: true,
  ...extra,
});

test('normalizeFindings rejects malformed reviewer output with every problem listed', () => {
  const task = { id: 't-1', skill: 's', origin: 'local', files: [{ path: 'a.ts' }] };
  assert.throws(() => normalizeFindings(task, { findings: [{ severity: 'HIGH', file: 'b.ts', start_line: 0 }] }), (e) => {
    for (const bit of ['severity', 'category', 'title', 'not one of this task', 'start_line', 'rule_id', 'introduced']) assert.match(e.message, new RegExp(bit));
    return true;
  });
  const [f] = normalizeFindings(task, [crit('a.ts', 3)]);
  assert.match(f.id, /^f-[0-9a-f]{10}$/);
  assert.equal(f.end_line, 3);
});

test('verdict: an unverified CRITICAL blocks; a rejected one passes; grounding drops invented lines', () => {
  const { root } = makeRepo();
  write(root, { 'server/src/modules/pulls/routes.ts': 'export default async function r() {\n  return db.select();\n}\n' });
  commit(root, 'feat(server): route');
  const file = 'server/src/modules/pulls/routes.ts';
  const blocked = review(root, { findings: { 'onion-architecture': [crit(file, 2), crit(file, 40, { title: 'Invented line' })] }, finalizeArgs: ['--confirm-self-change'] });
  assert.equal(blocked.verdict.status, 'BLOCKED');
  assert.equal(blocked.verdict.findings.find((f) => f.source === 'model').verification.outcome, 'missing');
  assert.equal(blocked.verdict.dropped.length, 1, 'line 40 is not in the diff');
  assert.match(blocked.report, /PR self-review — BLOCKED/);

  write(root, { 'server/src/modules/pulls/routes.ts': 'export default async function r() {\n  return db.select(1);\n}\n' });
  commit(root, 'fix(server): route');
  const passed = review(root, { findings: { 'onion-architecture': [crit(file, 2)] }, verify: [{ outcome: 'rejected', reason: 'db is a port here' }] });
  assert.equal(passed.verdict.status, 'PASS');
  assert.equal(passed.verdict.rejected.length, 1);
  const feedback = readFileSync(join(storeDir(root), 'feedback.jsonl'), 'utf8');
  assert.match(feedback, /rejected_by_verifier/);
});

test('verdict: a third-party CRITICAL that is not a bug is capped; a pre-existing one does not block', () => {
  const { root } = makeRepo();
  write(root, { 'server/src/modules/pulls/routes.ts': 'export default async function r() {\n  return 1;\n}\n' });
  commit(root, 'feat(server): route');
  const file = 'server/src/modules/pulls/routes.ts';
  const { verdict } = review(root, {
    findings: {
      'fastify-best-practices': [crit(file, 2, { category: 'style', rule_id: 'fastify/use-schema' })],
      'onion-architecture': [crit(file, 1, { introduced: false })],
    },
  });
  assert.equal(verdict.status, 'PASS');
  const capped = verdict.findings.find((f) => f.rule_id === 'fastify/use-schema');
  assert.equal(capped.severity, 'WARNING');
  assert.ok(verdict.findings.find((f) => f.pre_existing));
});

test('verdict: waivers need a reason, apply to LLM CRITICALs, carry over by rule + file, and never cover a secret', () => {
  const { root } = makeRepo();
  write(root, { 'server/src/modules/pulls/routes.ts': 'export default async function r() {\n  return db.select();\n}\n' });
  commit(root, 'feat(server): route');
  const file = 'server/src/modules/pulls/routes.ts';
  const first = review(root, { findings: { 'onion-architecture': [crit(file, 2)] }, verify: [{ outcome: 'confirmed', reason: 'real' }] });
  assert.equal(first.verdict.status, 'BLOCKED');
  const id = first.verdict.findings.find((f) => f.source === 'model').id;
  assert.notEqual(run(root, 'verdict.mjs', ['waive', '--id', id, '--reason', 'short']).code, 0);
  const ok = run(root, 'verdict.mjs', ['waive', '--id', id, '--reason', 'legacy route, tracked in issue 42']);
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stdout, /PR self-review — PASS/);
  assert.match(ok.stdout, /waived: legacy route/);

  // Same rule and file on the next run: the waiver applies by itself; the cache spares the reviewer.
  write(root, { 'docs/x.md': 'x\n' });
  commit(root, 'docs: note');
  const second = review(root);
  assert.equal(second.verdict.status, 'PASS');
  assert.equal(second.plan.tasks.filter((t) => t.skill === 'onion-architecture').length, 0, 'unchanged file comes from the cache');
  assert.ok(second.verdict.findings.find((f) => f.waived && f.cached));

  const REAL = `ghp_${'aB3dE5gH7jK9mN1pQ3sT5vX7zA9cE1gI3kM5'}`;
  write(root, { 'server/src/k.ts': `export const k = "${REAL}";\n` });
  commit(root, 'feat: key');
  const leaked = review(root);
  const secret = leaked.verdict.findings.find((f) => f.rule_id === 'secret/github-token');
  const refused = run(root, 'verdict.mjs', ['waive', '--id', secret.id, '--reason', 'it is only a test key, honestly']);
  assert.notEqual(refused.code, 0);
  assert.match(refused.stderr, /can't be waived/);
});

test('verdict: finalize refuses when the working copy changed during the review', () => {
  const { root } = makeRepo();
  write(root, { 'server/src/a.ts': 'export const a = 1;\n' });
  commit(root, 'feat: a');
  const sel = run(root, 'select-skills.mjs');
  const runId = /run (\S+)/.exec(sel.stdout)[1];
  run(root, 'checks.mjs', ['--run', runId, '--quick']);
  write(root, { 'server/src/a.ts': 'export const a = 2;\n' });
  const fin = run(root, 'verdict.mjs', ['finalize', '--run', runId, '--allow-incomplete']);
  assert.notEqual(fin.code, 0);
  assert.match(fin.stderr, /working copy changed/);
});

test('gate: no verdict → refused; full PASS → allowed; amend or quick → refused; docs only → allowed', () => {
  const { root } = makeRepo();
  write(root, { 'docs/guide.md': '# guide\n' });
  commit(root, 'docs: guide');
  assert.equal(checkCommit(root, git(root, 'rev-parse', 'HEAD')).ok, true, 'no reviewer applies to docs');

  write(root, { 'server/src/a.ts': 'export const a = 1;\n' });
  commit(root, 'feat: a');
  const head = () => git(root, 'rev-parse', 'HEAD');
  let r = checkCommit(root, head());
  assert.equal(r.ok, false);
  assert.match(r.reason, /no self-review verdict/);

  review(root);
  assert.equal(checkCommit(root, head()).ok, true);

  write(root, { 'server/src/a.ts': 'export const a = 2;\n' });
  git(root, 'commit', '-q', '-a', '--amend', '--no-edit');
  assert.equal(checkCommit(root, head()).ok, false);

  review(root, { selectArgs: ['--quick'] });
  r = checkCommit(root, head());
  assert.equal(r.ok, false);
  assert.match(r.reason, /--quick/);
});

test('gate: a reviewed-dirty tree passes once committed exactly; a secret in an earlier commit is refused anyway', () => {
  const { root } = makeRepo();
  write(root, { 'server/src/a.ts': 'export const a = 1;\n' });
  review(root);
  commit(root, 'feat: a');
  assert.equal(checkCommit(root, git(root, 'rev-parse', 'HEAD')).ok, true);

  const REAL = `ghp_${'aB3dE5gH7jK9mN1pQ3sT5vX7zA9cE1gI3kM5'}`;
  write(root, { 'server/src/b.ts': `export const b = "${REAL}";\n` });
  commit(root, 'feat: b');
  write(root, { 'server/src/b.ts': 'export const b = process.env.B;\n' });
  commit(root, 'fix: b');
  review(root);
  const r = checkCommit(root, git(root, 'rev-parse', 'HEAD'));
  assert.equal(r.ok, false);
  assert.match(r.reason, /secret-shaped/);
});

test('pre-push hook end to end: real git push is refused, then allowed after a PASS; deletes and tags pass', () => {
  const { root } = makeRepo();
  const install = run(root, 'install-hooks.mjs');
  assert.equal(install.code, 0, install.stderr);
  assert.equal(run(root, 'install-hooks.mjs', ['--status']).code, 0);
  write(root, { 'server/src/a.ts': 'export const a = 1;\n' });
  commit(root, 'feat: a');
  const push = (...args) => spawnSync('git', ['push', '-q', 'origin', ...args], { cwd: root, encoding: 'utf8' });
  let p = push('feature');
  assert.notEqual(p.status, 0);
  assert.match(p.stderr, /pr-self-review: push refused/);
  review(root);
  p = push('feature');
  assert.equal(p.status, 0, p.stderr);
  git(root, 'tag', 'v1');
  assert.equal(push('v1').status, 0);
  assert.equal(push('--delete', 'feature').status, 0);
  assert.equal(run(root, 'install-hooks.mjs', ['--uninstall']).code, 0);
});

test('classify: finds push / PR commands in compound shell, -C dirs, bypass attempts and content-less pushes', () => {
  assert.deepEqual(classify('npm test && git push origin feature').map((a) => a.kind), ['push']);
  assert.equal(classify('cd ../other && git push')[0].dir, '../other');
  assert.equal(classify('git -C /tmp/x push')[0].dir, '/tmp/x');
  assert.equal(classify('git push --no-verify')[0].noVerify, true);
  assert.equal(classify('git -c core.hooksPath=/dev/null push')[0].hooksPath, true);
  assert.equal(classify('git push origin --delete old')[0].contentless, true);
  assert.equal(classify('git push origin :old')[0].contentless, true);
  assert.deepEqual(classify('gh pr create --fill').map((a) => a.kind), ['pr']);
  assert.deepEqual(classify('git log --grep push'), []);
  assert.deepEqual(classify('echo "git push"'), []);
});

test('feedback: a finding that disappears after a fix is recorded as fixed; duplicates across lenses merge', () => {
  const { root } = makeRepo();
  const file = 'server/src/modules/pulls/routes.ts';
  write(root, { [file]: 'export default async function r() {\n  return db.select();\n}\n' });
  commit(root, 'feat(server): route');
  const warn = (skill) => ({ ...crit(file, 2), severity: 'WARNING', rule_id: 'onion/route-business-logic', title: 'Logic in route', category: 'style', _skill: skill });
  const first = review(root, { findings: { 'onion-architecture': [warn()], 'fastify-best-practices': [warn()] } });
  const merged = first.verdict.findings.filter((f) => f.rule_id === 'onion/route-business-logic');
  assert.equal(merged.length, 1, 'one problem seen by two lenses is reported once');
  assert.deepEqual(merged[0].also_from, ['fastify-best-practices']);
  write(root, { [file]: 'export default async function r() {\n  return service.list();\n}\n' });
  commit(root, 'fix(server): route calls the service');
  review(root);
  const feedback = readFileSync(join(storeDir(root), 'feedback.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(feedback.some((r) => r.id === merged[0].id && r.outcome === 'fixed'));
});
