import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectDiff } from '../collect-diff.mjs';
import { globToRegExp, readJson, SKILL_DIR } from '../lib.mjs';
import { driftCheck, plan, route } from '../select-skills.mjs';
import { linkSpecs, unchangedZone, inZone } from '../specs.mjs';
import { commit, makeRepo, write } from './helpers.mjs';

const routing = readJson(`${SKILL_DIR}/routing.json`);

test('globs: ** spans folders, Next.js segments are literal, braces alternate', () => {
  assert.ok(globToRegExp('client/src/**/*.{ts,tsx}').test('client/src/app/(shell)/repos/[repoId]/page.tsx'));
  assert.ok(globToRegExp('**/*.test.tsx').test('a.test.tsx'));
  assert.ok(!globToRegExp('client/src/*.ts').test('client/src/lib/a.ts'));
  assert.ok(globToRegExp('server/src/modules/**/routes.ts').test('server/src/modules/pulls/routes.ts'));
});

test('UI files go to UI skills, backend files to backend skills, by trigger to zod/typescript-expert', () => {
  const { root } = makeRepo();
  write(root, {
    'client/src/app/(shell)/x/page.tsx': 'export default function P() { return null; }\n',
    'client/src/lib/hooks/use-x.ts': 'export const useX = () => 1;\n',
    'server/src/modules/pulls/routes.ts': 'export default async function routes() {}\n',
    'server/src/modules/pulls/repository.ts': 'export class R {}\n',
    'server/src/lib/parse.ts': "import { z } from 'zod';\nexport const S = z.string();\nexport const bad: any = 1;\n",
    'docs/guide.md': '# guide\n',
  });
  commit(root);
  const { bySkill, unreviewed } = route(collectDiff(root), routing);
  const paths = (s) => (bySkill[s] ?? []).map((f) => f.path).sort();
  assert.deepEqual(paths('frontend-ui-architecture'), ['client/src/app/(shell)/x/page.tsx', 'client/src/lib/hooks/use-x.ts']);
  assert.deepEqual(paths('next-best-practices'), ['client/src/app/(shell)/x/page.tsx']);
  assert.ok(paths('react-best-practices').includes('client/src/lib/hooks/use-x.ts'));
  assert.deepEqual(paths('onion-architecture'), ['server/src/lib/parse.ts', 'server/src/modules/pulls/repository.ts', 'server/src/modules/pulls/routes.ts']);
  assert.deepEqual(paths('fastify-best-practices'), ['server/src/modules/pulls/routes.ts']);
  assert.deepEqual(paths('drizzle-orm-patterns'), ['server/src/modules/pulls/repository.ts']);
  assert.deepEqual(paths('zod'), ['server/src/lib/parse.ts']);
  assert.deepEqual(paths('typescript-expert'), ['server/src/lib/parse.ts']);
  assert.equal(bySkill['onion-architecture'].some((f) => f.path.startsWith('client/')), false, 'no UI file reaches a backend skill');
  assert.deepEqual(unreviewed, ['docs/guide.md']);
});

test('drift: a skill folder routing.json does not know fails the run', () => {
  const { root } = makeRepo();
  write(root, { '.claude/skills/shiny-new/SKILL.md': '---\nname: shiny-new\n---\n', '.claude/skills/zod/SKILL.md': 'x' });
  assert.deepEqual(driftCheck(root, routing).unrouted, ['shiny-new']);
  const real = driftCheck(`${SKILL_DIR}/../../..`, routing);
  assert.deepEqual(real.unrouted, [], 'every skill in this repo has a routing decision');
});

test('plan: batches respect the budget and an over-budget diff is incomplete', () => {
  const { root } = makeRepo();
  const files = {};
  for (let i = 0; i < 40; i++) files[`server/src/modules/m${i}/service.ts`] = `export const v${i} = ${i};\n`;
  write(root, files);
  commit(root);
  const diff = collectDiff(root);
  const p = plan(root, diff);
  const onion = p.tasks.filter((t) => t.skill === 'onion-architecture');
  assert.equal(onion.length, 3, '40 files in batches of 15');
  assert.ok(onion.every((t) => t.files.length <= 15));
  assert.equal(plan(root, diff, { maxTasks: 2 }).coverage, 'incomplete');
});

test('specs: linked by name or slug; only an active spec has a binding Unchanged zone', () => {
  const spec = '# Feature\n\n**Unchanged (no diff at all):**\n- the sidebar (`RunTraceDrawer/**`);\n- `FindingCard` and its helpers.\n\n## API\n';
  const { root } = makeRepo({ 'server/specs/02-findings-by-severity.md': spec });
  write(root, { 'client/src/app/x/_components/FindingCard/FindingCard.tsx': 'export const A = 1;\n' });
  commit(root, 'feat(client): tweak card');
  let [link] = linkSpecs(root, collectDiff(root));
  assert.equal(link.active, false, 'only names a file: inactive');
  write(root, { 'client/src/app/x/_components/FindingCard/FindingCard.tsx': 'export const A = 2;\n' });
  commit(root, 'feat(client): 02-findings-by-severity card');
  [link] = linkSpecs(root, collectDiff(root));
  assert.equal(link.active, true);
  const zone = unchangedZone(spec);
  assert.deepEqual(zone.items, ['RunTraceDrawer/**', 'FindingCard']);
  assert.ok(inZone('client/src/app/x/_components/FindingCard/styles.ts', 'FindingCard'));
  assert.ok(inZone('client/src/app/x/_components/RunTraceDrawer/a/b.tsx', 'RunTraceDrawer/**'));
  assert.ok(!inZone('client/src/app/x/_components/FindingCards/a.tsx', 'FindingCard'));
});
