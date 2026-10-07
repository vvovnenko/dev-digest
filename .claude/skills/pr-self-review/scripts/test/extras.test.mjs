import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectDiff } from '../collect-diff.mjs';
import { buildDescription, compareUrl, githubRepo } from '../pr-description.mjs';
import { publish } from '../publish-status.mjs';
import { aggregate } from '../stats.mjs';
import { commit, git, makeRepo, write } from './helpers.mjs';

const verdict = (over = {}) => ({
  status: 'PASS',
  tree: 'a'.repeat(40),
  base_ref: 'origin/main',
  branch: 'l02/self-review',
  counts: { CRITICAL: 1, WARNING: 2, SUGGESTION: 0, blocking: 0, waived: 1, pre_existing: 0 },
  checks: [{ id: 'D7', title: 'Typecheck', status: 'pass', notes: ['server typecheck: ok (10.1 s)'] }],
  skills_run: [{ skill: 'onion-architecture', files: 2 }],
  findings: [{ skill: 'onion-architecture', rule_id: 'onion/route-no-sql', file: 'server/src/modules/a/routes.ts', severity: 'CRITICAL', waived: { reason: 'legacy route, issue 42' } }],
  specs: [],
  ...over,
});

test('PR description: sections, risks from the diff and waivers, attribution, compare URL', () => {
  const { root } = makeRepo();
  write(root, {
    'server/src/db/migrations/0015_x.sql': 'ALTER TABLE a ADD b int;\n',
    'server/src/modules/a/routes.ts': 'export {};\n',
    'server/test/a.test.ts': 'test;\n',
  });
  commit(root, 'feat(server): a');
  const diff = collectDiff(root);
  const { title, body } = buildDescription(verdict(), diff, { summary: '- adds a' });
  assert.equal(title, 'feat(server): a');
  for (const part of ['## Summary', '- adds a', '## Changes by package', '**server/**', '## Risks', '0015_x.sql', 'legacy route, issue 42', '## Testing', '`server/test/a.test.ts`', '## Self-review', '| onion-architecture | 2 | 1 |', 'Generated with [Claude Code]']) {
    assert.ok(body.includes(part), `missing: ${part}`);
  }
  git(root, 'remote', 'set-url', 'origin', 'git@github.com:vvovnenko/dev-digest.git');
  assert.deepEqual(githubRepo(root), { owner: 'vvovnenko', repo: 'dev-digest' });
  assert.equal(
    compareUrl(root, verdict(), 'feat: x'),
    'https://github.com/vvovnenko/dev-digest/compare/main...l02%2Fself-review?expand=1&title=feat%3A%20x',
  );
});

test('stats: the last outcome per finding counts; a noisy CRITICAL rule gets a proposal', () => {
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push({ branch: 'b', id: `f${i}`, rule_id: 'ui/sibling-import', skill: 'frontend-ui-architecture', severity: 'CRITICAL', outcome: i < 4 ? 'waived' : 'fixed' });
  rows.push({ branch: 'b', id: 'f0', rule_id: 'ui/sibling-import', skill: 'frontend-ui-architecture', severity: 'CRITICAL', outcome: 'fixed' });
  rows.push({ branch: 'b', id: 'g', rule_id: 'onion/route-no-sql', skill: 'onion-architecture', severity: 'CRITICAL', outcome: 'fixed' });
  const { rules, proposals } = aggregate(rows);
  const ui = rules.find((r) => r.rule_id === 'ui/sibling-import');
  assert.deepEqual([ui.n, ui.fixed, ui.waived], [6, 3, 3]);
  assert.equal(proposals.length, 0, '50% is not under 50%');
  rows.push({ branch: 'b', id: 'f0', rule_id: 'ui/sibling-import', skill: 'frontend-ui-architecture', severity: 'CRITICAL', outcome: 'rejected_by_verifier' });
  assert.match(aggregate(rows).proposals[0], /Consider demoting `ui\/sibling-import`/);
});

test('publish: no token → nothing; unpushed commit → nothing; pushed → one POST with the gate decision', async () => {
  const { root } = makeRepo();
  write(root, { 'docs/a.md': 'x\n' });
  const sha = commit(root, 'docs: a');
  assert.match((await publish(root, sha, { token: '' })).message, /not set/);
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization });
    return { ok: true, status: 201, text: async () => '' };
  };
  const realUrl = git(root, 'remote', 'get-url', 'origin');
  git(root, 'push', '-q', '--no-verify', 'origin', 'feature');
  git(root, 'fetch', '-q', 'origin');
  git(root, 'remote', 'set-url', 'origin', 'https://github.com/vvovnenko/dev-digest.git');
  write(root, { 'docs/b.md': 'y\n' });
  const unpushed = commit(root, 'docs: b');
  assert.match((await publish(root, unpushed, { token: 't', fetchImpl })).message, /not on any remote branch/);
  const r = await publish(root, sha, { token: 't', fetchImpl });
  assert.equal(r.ok, true, r.message);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.github.com/repos/vvovnenko/dev-digest/statuses/${sha}`);
  assert.equal(calls[0].body.context, 'devdigest/pr-self-review');
  assert.equal(calls[0].body.state, 'success', 'docs only: the gate lets it through');
  assert.equal(calls[0].auth, 'Bearer t');
  git(root, 'remote', 'set-url', 'origin', realUrl);
});
