import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SimpleGitClient } from '../src/adapters/git/simple-git.js';
import { githubAuthConfig, withoutCredentials } from '../src/adapters/git/credentials.js';

/** No network: remotes point at a closed local port, so every fetch fails at once. */
const UNREACHABLE = 'https://127.0.0.1:1/acme/app.git';

let root: string;
let cloneDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'devdigest-git-'));
  cloneDir = join(root, 'clones');
  await mkdir(cloneDir);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

describe('SimpleGitClient clone path', () => {
  it('maps a repo to <cloneDir>/<owner>/<name>', () => {
    const git = new SimpleGitClient(cloneDir);
    expect(git.clonePathFor({ owner: 'acme', name: 'next.js' })).toBe(join(cloneDir, 'acme', 'next.js'));
  });

  it.each([
    { owner: '..', name: 'src' },
    { owner: 'acme', name: '..' },
    { owner: '.', name: 'app' },
    { owner: 'acme/..', name: 'app' },
    { owner: 'acme', name: 'a/b' },
    { owner: '', name: 'app' },
  ])('refuses an escaping or malformed ref %o', (repo) => {
    const git = new SimpleGitClient(cloneDir);
    expect(() => git.clonePathFor(repo)).toThrow(/Unsafe repo path/);
  });

  it('never deletes outside cloneDir, even for a ref that points there', async () => {
    // Regression: owner `..` made clone() rm -rf a sibling of cloneDir.
    const sibling = join(root, 'src');
    await mkdir(sibling);
    await writeFile(join(sibling, 'keep.ts'), 'export {};\n');

    const git = new SimpleGitClient(cloneDir);
    await expect(git.clone({ owner: '..', name: 'src' }, UNREACHABLE)).rejects.toThrow(/Unsafe repo path/);
    expect(await exists(join(sibling, 'keep.ts'))).toBe(true);
  });
});

describe('SimpleGitClient credentials', () => {
  it('removes a token an older clone stored in origin, and never writes the auth header', async () => {
    const dest = join(cloneDir, 'acme', 'app');
    await mkdir(dest, { recursive: true });
    execFileSync('git', ['init', '-q', dest]);
    execFileSync('git', ['-C', dest, 'remote', 'add', 'origin', 'https://x-access-token:SECRET@github.com/acme/app.git']);

    const git = new SimpleGitClient(cloneDir, async () => 'TOKEN');
    // The fetch fails (unreachable host); the origin is rewritten before it.
    await expect(git.clone({ owner: 'acme', name: 'app' }, UNREACHABLE)).rejects.toThrow();

    const config = await readFile(join(dest, '.git', 'config'), 'utf8');
    expect(config).not.toContain('SECRET');
    expect(config).not.toContain('TOKEN');
    expect(config).not.toContain('extraheader');
    expect(config).toContain(`url = ${UNREACHABLE}`);
  });

  it('refuses file:// remotes', async () => {
    const git = new SimpleGitClient(cloneDir);
    await expect(git.clone({ owner: 'acme', name: 'local' }, `file://${root}`)).rejects.toThrow(/not allowed/i);
  });

  it('builds a github.com-scoped basic auth header', () => {
    const entry = githubAuthConfig('ghp_abc');
    expect(entry).toBe(
      `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from('x-access-token:ghp_abc').toString('base64')}`,
    );
  });

  it.each([
    ['https://x-access-token:SECRET@github.com/acme/app.git', 'https://github.com/acme/app.git'],
    ['https://github.com/acme/app.git', 'https://github.com/acme/app.git'],
    ['git@github.com:acme/app.git', 'git@github.com:acme/app.git'],
  ])('strips credentials from %s', (input, expected) => {
    expect(withoutCredentials(input)).toBe(expected);
  });
});

describe('SimpleGitClient.readFile', () => {
  it('reads inside the clone, and refuses `..` and symlinks that lead out of it', async () => {
    const { symlink } = await import('node:fs/promises');
    const base = await mkdtemp(join(tmpdir(), 'devdigest-read-'));
    try {
      const clone = join(base, 'clones', 'acme', 'app');
      await mkdir(join(clone, 'src'), { recursive: true });
      await writeFile(join(clone, 'src', 'ok.ts'), 'inside');
      await writeFile(join(base, 'secret.txt'), 'outside');
      await symlink(join(base, 'secret.txt'), join(clone, 'src', 'link.ts'));
      const git = new SimpleGitClient(join(base, 'clones'));
      const repo = { owner: 'acme', name: 'app' };

      expect(await git.readFile(repo, 'src/ok.ts')).toBe('inside');
      await expect(git.readFile(repo, '../../../secret.txt')).rejects.toThrow(/outside the repository/);
      await expect(git.readFile(repo, 'src/link.ts')).rejects.toThrow(/outside the repository/);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

describe('SimpleGitClient.defaultBranch', () => {
  // The adapter limits git to https (GIT_ALLOW_PROTOCOL); this test's fixture remote is a local file:// repo.
  const git = (...args: string[]) =>
    execFileSync('git', args, { stdio: 'ignore', env: { ...process.env, GIT_ALLOW_PROTOCOL: 'file' } });

  it("names the remote's default branch in a shallow clone, and throws on a detached HEAD", async () => {
    const remote = join(root, 'remote');
    git('init', '-q', '-b', 'trunk', remote);
    await writeFile(join(remote, 'a.txt'), 'a');
    git('-C', remote, 'add', '.');
    git('-C', remote, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
    const clone = join(cloneDir, 'acme', 'app');
    git('clone', '-q', '--depth', '1', `file://${remote}`, clone);
    const adapter = new SimpleGitClient(cloneDir);
    const repo = { owner: 'acme', name: 'app' };

    expect(await adapter.defaultBranch(repo)).toBe('trunk');

    // No origin/HEAD and no branch checked out: nothing to go on.
    git('-C', clone, 'remote', 'set-head', 'origin', '-d');
    git('-C', clone, 'checkout', '-q', '--detach');
    await expect(adapter.defaultBranch(repo)).rejects.toThrow(/Cannot tell the default branch/);
  });
});
