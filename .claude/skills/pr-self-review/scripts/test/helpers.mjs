// Throwaway git repos for the pr-self-review tests: a bare "origin", a clone
// with origin/HEAD → origin/main, and helpers to write, commit and review.
// The user's global git config is replaced, so signing, hooks or templates
// configured on the machine can't leak into a test.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const sandbox = mkdtempSync(join(tmpdir(), 'pr-self-review-test-'));
const gitconfig = join(sandbox, 'gitconfig');
writeFileSync(gitconfig, '[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n');
process.env.GIT_CONFIG_GLOBAL = gitconfig;
process.env.GIT_CONFIG_NOSYSTEM = '1';
process.on('exit', () => rmSync(sandbox, { recursive: true, force: true }));

export function sh(cwd, cmd, ...args) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).replace(/\n$/, '');
}

export const git = (cwd, ...args) => sh(cwd, 'git', ...args);

export function write(root, files) {
  for (const [path, content] of Object.entries(files)) {
    if (content === null) {
      rmSync(join(root, path), { force: true });
      continue;
    }
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

export function commit(root, message = 'chore: test commit') {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '--no-verify', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

/** A clone whose origin/main holds `base` files, checked out on `feature`. */
export function makeRepo(base = { 'README.md': '# demo\n' }) {
  const dir = mkdtempSync(join(sandbox, 'repo-'));
  const remote = join(dir, 'origin.git');
  const root = join(dir, 'work');
  git(dir, 'init', '-q', '--bare', remote);
  mkdirSync(root);
  git(root, 'init', '-q');
  write(root, base);
  commit(root, 'chore: base');
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'push', '-q', '--no-verify', 'origin', 'main');
  git(root, 'fetch', '-q', 'origin');
  git(root, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  git(root, 'checkout', '-q', '-b', 'feature');
  return { root, remote };
}

/** Run a script from scripts/ with cwd = the repo; returns { code, stdout, stderr }. */
export function run(root, script, args = [], input = '') {
  const r = spawnSync('node', [join(SCRIPTS, script), ...args], { cwd: root, input, encoding: 'utf8', env: process.env });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
