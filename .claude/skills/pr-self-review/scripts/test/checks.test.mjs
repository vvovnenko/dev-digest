import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyCitationFixes, checkCitations } from '../citations.mjs';
import { firstLostLine, looksFake, runChecks, scanPushedCommits } from '../checks.mjs';
import { collectDiff } from '../collect-diff.mjs';
import { commit, git, makeRepo, write } from './helpers.mjs';

const REAL_GH = `ghp_${'aB3dE5gH7jK9mN1pQ3sT5vX7zA9cE1gI3kM5'}`;

async function findings(root, rule) {
  const { findings: all } = await runChecks(root, collectDiff(root), { mode: 'ci' });
  return rule ? all.filter((f) => f.rule_id === rule) : all;
}

test('D1: a real-looking token is CRITICAL, placeholders and fixtures are not', async () => {
  assert.equal(looksFake('sk_live_xxx'), true);
  assert.equal(looksFake(`ghp_${'X'.repeat(36)}`), true);
  assert.equal(looksFake(REAL_GH), false);
  const { root } = makeRepo();
  write(root, { 'server/src/config.ts': `export const token = "${REAL_GH}";\nexport const fake = "sk_live_xxx";\n` });
  commit(root);
  const hits = await findings(root, 'secret/github-token');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].severity, 'CRITICAL');
  assert.equal(hits[0].waivable, false);
  assert.ok(!hits[0].title.includes(REAL_GH), 'the report never echoes the full token');
});

test('D1: a key added in one commit and removed in the next is still caught in the pushed range', () => {
  const { root } = makeRepo();
  write(root, { 'a.ts': `const k = "${REAL_GH}";\n` });
  commit(root, 'feat: add');
  write(root, { 'a.ts': 'const k = process.env.K;\n' });
  commit(root, 'fix: remove');
  const hits = scanPushedCommits(root, git(root, 'rev-parse', 'HEAD'), 'origin');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, 'a.ts');
});

test('D2: lockfile without its manifest and a second lockfile type', async () => {
  const { root } = makeRepo({ 'server/package.json': '{}\n', 'server/pnpm-lock.yaml': 'a\n' });
  write(root, { 'server/pnpm-lock.yaml': 'b\n', 'server/package-lock.json': '{}\n' });
  commit(root);
  const rules = (await findings(root)).filter((f) => f.check === 'D2').map((f) => f.rule_id).sort();
  assert.deepEqual(rules, ['dnt/lockfile-without-manifest', 'dnt/lockfile-without-manifest', 'dnt/second-lockfile']);
});

test('D3: an edited migration and a rewritten journal are CRITICAL; an appended journal is fine', async () => {
  const journal = (entries) => JSON.stringify({ version: '7', dialect: 'postgresql', entries }, null, 2);
  const e0 = { idx: 0, tag: '0000_init' };
  const { root } = makeRepo({
    'server/src/db/migrations/0000_init.sql': 'CREATE TABLE a (id int);\n',
    'server/src/db/migrations/meta/_journal.json': journal([e0]),
  });
  write(root, {
    'server/src/db/migrations/0001_next.sql': 'ALTER TABLE a ADD b int;\n',
    'server/src/db/migrations/meta/_journal.json': journal([e0, { idx: 1, tag: '0001_next' }]),
  });
  commit(root);
  assert.equal((await findings(root)).filter((f) => f.check === 'D3').length, 0);
  write(root, {
    'server/src/db/migrations/0000_init.sql': 'CREATE TABLE a (id bigint);\n',
    'server/src/db/migrations/meta/_journal.json': journal([{ idx: 0, tag: '0000_renamed' }]),
  });
  commit(root);
  const rules = (await findings(root)).filter((f) => f.check === 'D3').map((f) => f.rule_id).sort();
  assert.deepEqual(rules, ['migrations/edited', 'migrations/journal-rewritten']);
});

test('D4: mirror drift, and a runtime import of @devdigest/shared in the client', async () => {
  const { root } = makeRepo({
    'server/src/vendor/shared/a.ts': 'export type A = 1;\n',
    'client/src/vendor/shared/a.ts': 'export type A = 1;\n',
  });
  write(root, {
    'server/src/vendor/shared/a.ts': 'export type A = 2;\n',
    'client/src/lib/x.ts': 'import type { A } from "@devdigest/shared";\nimport {\n  FEATURE_MODELS,\n} from "@devdigest/shared";\n',
  });
  commit(root);
  const d4 = (await findings(root)).filter((f) => f.check === 'D4');
  assert.deepEqual(d4.map((f) => f.rule_id).sort(), ['contracts/client-runtime-shared-import', 'contracts/mirror-drift']);
  const imp = d4.find((f) => f.rule_id === 'contracts/client-runtime-shared-import');
  assert.deepEqual([imp.start_line, imp.end_line], [2, 4]);
});

test('D5: appending to INSIGHTS without a final newline is fine; changing a line is CRITICAL', async () => {
  assert.equal(firstLostLine('a\nb', 'a\nb\nc\n'), -1);
  assert.equal(firstLostLine('a\nb\n', 'a\nB\n'), 1);
  const { root } = makeRepo({ 'server/INSIGHTS.md': '# x\n- old entry' });
  write(root, { 'server/INSIGHTS.md': '# x\n- old entry\n- new entry\n' });
  commit(root);
  assert.equal((await findings(root, 'insights/rewritten')).length, 0);
  write(root, { 'server/INSIGHTS.md': '# x\n- old entry (edited)\n- new entry\n' });
  commit(root);
  assert.equal((await findings(root, 'insights/rewritten')).length, 1);
});

test('D6: a grown ALLOWED map is CRITICAL; a ratchet this branch introduces is not', async () => {
  const ratchet = (n) => `const ALLOWED: Record<string, number> = {\n  'a/routes.ts': ${n},\n};\n`;
  const { root } = makeRepo({ 'server/test/routes-container-ratchet.test.ts': ratchet(1) });
  write(root, { 'server/test/routes-container-ratchet.test.ts': ratchet(2), 'server/test/migrations-safety.test.ts': "const ALLOWED: Record<string, string> = {\n  'x.sql': 'ok',\n};\n" });
  commit(root);
  const hits = await findings(root, 'arch/ratchet-loosened');
  assert.deepEqual(hits.map((f) => f.file), ['server/test/routes-container-ratchet.test.ts']);
});

test('D8: an active spec\'s Unchanged zone yields one candidate per item, sent to the verifier', async () => {
  const { root } = makeRepo({ 'server/specs/02-cards.md': '# Cards\n\n**Unchanged (no diff at all):**\n- `FindingCard` and helpers.\n\n## API\n' });
  write(root, { 'client/src/app/_components/FindingCard/FindingCard.tsx': 'export const A = 1;\n', 'client/src/app/_components/FindingCard/styles.ts': 'export const s = {};\n' });
  commit(root, 'feat(client): 02-cards');
  const [f] = await findings(root, 'spec/unchanged-zone');
  assert.equal(f.needs_verification, true);
  assert.equal(f.waivable, true);
  assert.match(f.title, /2 file\(s\)/);
});

test('D9: a shifted full-path citation is fixed in place; CLAUDE.md is only reported', () => {
  const code = Array.from({ length: 10 }, (_, i) => `const l${i + 1} = ${i + 1};`).join('\n') + '\n';
  const { root } = makeRepo({
    'server/src/app.ts': code,
    'server/docs/architecture.md': 'Errors are mapped in `src/app.ts:7-8` once.\n',
    'server/CLAUDE.md': 'See `server/src/app.ts:7`.\n',
  });
  write(root, { 'server/src/app.ts': `// header\n// more\n${code}` });
  commit(root);
  const found = checkCitations(root, collectDiff(root));
  const doc = found.find((f) => f.file === 'server/docs/architecture.md');
  assert.equal(doc.rule_id, 'docs/citation-shifted');
  assert.deepEqual(doc.fix, { find: 'src/app.ts:7-8', replace: 'src/app.ts:9-10' });
  const claude = found.find((f) => f.file === 'server/CLAUDE.md');
  assert.equal(claude.fix, null);
  applyCitationFixes(root, found);
  assert.equal(readFileSync(join(root, 'server/docs/architecture.md'), 'utf8'), 'Errors are mapped in `src/app.ts:9-10` once.\n');
  assert.equal(readFileSync(join(root, 'server/CLAUDE.md'), 'utf8'), 'See `server/src/app.ts:7`.\n');
});

test('D9: a citation of changed lines asks for a human; an unrelated path is ignored', () => {
  const code = Array.from({ length: 10 }, (_, i) => `const l${i + 1} = ${i + 1};`).join('\n') + '\n';
  const { root } = makeRepo({ 'server/src/app.ts': code, 'server/docs/a.md': '`src/app.ts:4` and `[number]/constants.ts:10`\n' });
  write(root, { 'server/src/app.ts': code.replace('const l4 = 4;', 'const l4 = 40;') });
  commit(root);
  const found = checkCitations(root, collectDiff(root));
  assert.deepEqual(found.map((f) => f.rule_id), ['docs/cited-lines-changed']);
});

test('D10 and D11: logic without a test, and unfinished / non-conventional commits', async () => {
  const { root } = makeRepo();
  write(root, { 'client/src/lib/format.ts': 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n' });
  commit(root, 'wip');
  write(root, { 'docs/x.md': 'x\n' });
  commit(root, 'Update docs');
  const all = await findings(root);
  const d10 = all.find((f) => f.rule_id === 'test/logic-without-test');
  assert.equal(d10.severity, 'WARNING');
  assert.match(d10.suggestion, /client\/src\/lib\/format\.test\.ts/);
  assert.deepEqual(all.filter((f) => f.check === 'D11').map((f) => f.rule_id).sort(), ['commits/not-conventional', 'commits/unfinished']);
});

test('S: messages JSON and copy that an e2e flow asserts', async () => {
  const flow = { name: 'x', steps: [{ cmd: ['wait', '--text', 'Request changes'] }] };
  const { root } = makeRepo({
    'client/messages/en/pr.json': '{"verdict": {"rc": "Request changes"}}\n',
    'e2e/specs/04-x.flow.json': JSON.stringify(flow),
  });
  write(root, { 'client/messages/en/pr.json': '{"verdict": {"rc": "Ask for edits"}}\n' });
  commit(root);
  assert.equal((await findings(root, 'e2e/asserted-copy-removed')).length, 1);
  write(root, { 'client/messages/en/pr.json': '{"verdict": {"rc": "Ask for edits"},}\n' });
  commit(root);
  assert.equal((await findings(root, 'i18n/invalid-json')).length, 1);
});
