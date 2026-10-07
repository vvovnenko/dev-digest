import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectDiff } from '../collect-diff.mjs';
import { worktreeTree } from '../lib.mjs';
import { commit, git, makeRepo, write } from './helpers.mjs';

test('a file with a NUL byte still gets hunks (git would call it binary)', () => {
  const { root } = makeRepo({ 'src/graph.ts': 'const a = 1;\nconst key = `${a}\0b`;\n' });
  write(root, { 'src/graph.ts': 'const a = 2;\nconst key = `${a}\0b`;\n' });
  commit(root);
  const f = collectDiff(root).files.find((x) => x.path === 'src/graph.ts');
  assert.equal(f.binary, false);
  assert.deepEqual(f.added, [[1, 1]]);
  assert.equal(f.added_count, 1);
});

test('a pure rename is flagged and has no hunks; blobs identify both sides', () => {
  const body = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n') + '\n';
  const { root } = makeRepo({ 'client/src/app/old/Card.tsx': body });
  write(root, { 'client/src/app/old/Card.tsx': null, 'client/src/app/(shell)/new/Card.tsx': body });
  commit(root);
  const [f] = collectDiff(root).files;
  assert.equal(f.status, 'R');
  assert.equal(f.pure_rename, true);
  assert.equal(f.old_path, 'client/src/app/old/Card.tsx');
  assert.equal(f.path, 'client/src/app/(shell)/new/Card.tsx');
  assert.equal(f.old_blob, f.new_blob);
});

test('the reviewed tree includes untracked files and equals the commit made with git add -A', () => {
  const { root } = makeRepo();
  write(root, { 'notes.md': 'draft\n', 'README.md': '# demo\nmore\n' });
  const dirty = worktreeTree(root);
  assert.equal(dirty.dirty, true);
  const diff = collectDiff(root);
  assert.deepEqual(diff.files.map((f) => f.path).sort(), ['README.md', 'notes.md']);
  assert.equal(git(root, 'status', '--porcelain', '--', 'notes.md'), '?? notes.md', 'the real index is untouched');
  commit(root);
  assert.equal(worktreeTree(root).tree, dirty.tree, 'committing exactly the reviewed state keeps the fingerprint');
  write(root, { 'README.md': '# demo\nmore!\n' });
  git(root, 'commit', '-q', '-a', '--amend', '--no-edit');
  assert.notEqual(worktreeTree(root).tree, dirty.tree, 'an amend changes it');
});

test('generated and excluded files are marked; commits are listed', () => {
  const { root } = makeRepo();
  write(root, { 'client/pnpm-lock.yaml': 'lock\n', 'server/src/db/migrations/meta/_journal.json': '{}\n', 'docs/a.md': 'x\n' });
  commit(root, 'feat(client): add things');
  const diff = collectDiff(root);
  const by = Object.fromEntries(diff.files.map((f) => [f.path, f]));
  assert.equal(by['client/pnpm-lock.yaml'].generated, true);
  assert.equal(by['server/src/db/migrations/meta/_journal.json'].generated, true);
  assert.equal(by['docs/a.md'].generated, false);
  assert.equal(diff.commits.length, 1);
  assert.equal(diff.commits[0].subject, 'feat(client): add things');
  assert.equal(diff.base_ref, 'origin/main');
});
