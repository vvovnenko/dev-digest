import { simpleGit, type SimpleGit } from 'simple-git';
import { join, resolve, sep } from 'node:path';
import { mkdir, readFile, access, rm, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import type {
  GitClient,
  RepoRef,
  CloneOptions,
  UnifiedDiff,
  BlameLine,
  GitCommit,
} from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';
import { parseUnifiedDiff } from './diff-parser.js';
import { githubAuthConfig, withoutCredentials } from './credentials.js';

/** A path-safe owner or repo segment: no separators, never `.` or `..`. */
const SAFE_SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;

/**
 * Depth fetched by `sync()`. Deeper than the shallow clone (CLONE_DEPTH=1) so the
 * previously-indexed sha is usually reachable, keeping the resync diff incremental;
 * when it isn't, the indexer falls back to a full reindex.
 */
const RESYNC_FETCH_DEPTH = 50;

/**
 * GitClient over simple-git. Repos clone to
 * `<cloneDir>/<owner>/<repo>`. We NEVER execute repo code — only git ops.
 */
export class SimpleGitClient implements GitClient {
  constructor(
    private cloneDir: string,
    /** GitHub PAT for commands that reach the remote; read per command, so a key saved in Settings applies at once. */
    private githubToken: () => Promise<string | undefined> = async () => undefined,
  ) {
    // Force non-interactive auth so an unauthenticated/private clone fails in
    // ~1s with a clear error instead of hanging on a credential prompt until the
    // job timeout. Set on process.env (inherited by git subprocesses) rather
    // than via simple-git's .env(), which inspects and rejects vars like
    // PAGER/EDITOR present in the shell environment.
    process.env.GIT_TERMINAL_PROMPT ??= '0';
    process.env.GCM_INTERACTIVE ??= 'never';
    // Remotes may only be https or ssh — no file://, git:// or ext::. Clone URLs
    // are rebuilt from a validated owner/name upstream; this is defence in depth.
    process.env.GIT_ALLOW_PROTOCOL ??= 'https:ssh';
  }

  /**
   * `<cloneDir>/<owner>/<repo>`. Refuses segments that could leave `cloneDir`:
   * `clone()` deletes a partial destination, so an escaping path would delete
   * whatever it points at.
   */
  clonePathFor(repo: RepoRef): string {
    const root = resolve(this.cloneDir);
    if (
      !SAFE_SEGMENT.test(repo.owner) ||
      !SAFE_SEGMENT.test(repo.name) ||
      !resolve(root, repo.owner, repo.name).startsWith(root + sep)
    ) {
      throw new AppError('invalid_repo_ref', `Unsafe repo path '${repo.owner}/${repo.name}'`, 400);
    }
    return join(this.cloneDir, repo.owner, repo.name);
  }

  private git(repo: RepoRef): SimpleGit {
    return simpleGit(this.clonePathFor(repo));
  }

  /** simple-git for commands that reach the remote, authenticated per command. */
  private async remote(baseDir: string): Promise<SimpleGit> {
    const token = await this.githubToken();
    return simpleGit({ baseDir, config: token ? [githubAuthConfig(token)] : [] });
  }

  /** Point `origin` at `url` (or its current URL) without credentials; older clones stored the PAT there. */
  private async resetOrigin(g: SimpleGit, url?: string): Promise<void> {
    let current: string;
    try {
      current = (await g.raw(['remote', 'get-url', 'origin'])).trim();
    } catch {
      return; // no origin — nothing stored
    }
    const next = withoutCredentials(url ?? current);
    if (next !== current) await g.raw(['remote', 'set-url', 'origin', next]);
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await access(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async clone(repo: RepoRef, url: string, opts?: CloneOptions): Promise<{ path: string }> {
    const dest = this.clonePathFor(repo);
    await mkdir(join(this.cloneDir, repo.owner), { recursive: true });
    if (await this.exists(join(dest, '.git'))) {
      // already cloned → drop any stored credentials, then fetch latest
      const g = await this.remote(dest);
      await this.resetOrigin(g, url);
      await g.fetch();
      return { path: dest };
    }
    // A prior clone may have timed out mid-write, leaving a partial dir without
    // a .git — git clone refuses a non-empty dest, so clear it first.
    if (await this.exists(dest)) await rm(dest, { recursive: true, force: true });
    const args: string[] = [];
    if (opts?.depth) args.push('--depth', String(opts.depth));
    if (opts?.branch) args.push('--branch', opts.branch);
    await (await this.remote(this.cloneDir)).clone(withoutCredentials(url), dest, args);
    return { path: dest };
  }

  async fetchPullHead(repo: RepoRef, n: number): Promise<void> {
    // Fetch the PR head ref into a local ref (GitHub exposes pull/<n>/head).
    const g = await this.remote(this.clonePathFor(repo));
    await this.resetOrigin(g);
    await g.fetch(['origin', `pull/${n}/head:pr-${n}`]);
  }

  async sync(repo: RepoRef, branch: string): Promise<{ head: string }> {
    // Resync the read-only mirror to upstream. A bare `fetch` only moves
    // `origin/<branch>`, so we `reset --hard` to advance local HEAD + worktree —
    // safe here because we never commit to or run code from the clone.
    // Fetch a bounded depth (> the shallow CLONE_DEPTH) so the prior indexed sha
    // is usually reachable for an incremental diff; the indexer falls back to a
    // full reindex when it isn't.
    const g = await this.remote(this.clonePathFor(repo));
    await this.resetOrigin(g);
    // --end-of-options: a branch name is data, never a flag (e.g. `--upload-pack=…`).
    await g.fetch(['--depth', String(RESYNC_FETCH_DEPTH), '--end-of-options', 'origin', branch]);
    await g.reset(['--hard', `origin/${branch}`]);
    return { head: (await g.revparse(['HEAD'])).trim() };
  }

  async currentHead(repo: RepoRef): Promise<string> {
    return (await this.git(repo).revparse(['HEAD'])).trim();
  }

  async defaultBranch(repo: RepoRef): Promise<string> {
    const g = this.git(repo);
    // `git clone` records the remote's HEAD as refs/remotes/origin/HEAD (shallow too).
    const originHead = await g
      .raw(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
      .then((ref) => ref.trim().replace(/^origin\//, ''))
      .catch(() => '');
    const branch = originHead || (await g.revparse(['--abbrev-ref', 'HEAD'])).trim();
    if (!branch || branch === 'HEAD') throw new Error(`Cannot tell the default branch of ${repo.owner}/${repo.name}`);
    return branch;
  }

  async diff(repo: RepoRef, base: string, head: string): Promise<UnifiedDiff> {
    // Pin the output format against the user's gitconfig: no C-quoting of
    // non-ASCII paths, no external diff driver or colour, and `a/`/`b/`
    // prefixes even with diff.mnemonicPrefix / diff.noprefix set — the parser
    // relies on all four.
    const g = simpleGit({ baseDir: this.clonePathFor(repo), config: ['core.quotePath=false'] });
    const raw = await g.diff([
      '--no-ext-diff',
      '--no-color',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      '--end-of-options',
      `${base}...${head}`,
    ]);
    return parseUnifiedDiff(raw);
  }

  /**
   * `git diff --name-only base..head` — used by the incremental indexer to
   * pick the file set that changed since `last_indexed_sha`. Two-dot is
   * intentional (commits reachable from `head` but not `base`), unlike the
   * three-dot symmetric form `diff()` uses for review diffs.
   */
  async diffNameOnly(repo: RepoRef, base: string, head: string): Promise<string[]> {
    if (base === head) return [];
    const raw = await this.git(repo).raw(['diff', '--name-only', '--end-of-options', `${base}..${head}`]);
    return raw
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  async blame(repo: RepoRef, path: string): Promise<BlameLine[]> {
    const raw = await this.git(repo).raw(['blame', '--line-porcelain', '--', path]);
    return parseBlamePorcelain(raw);
  }

  async log(repo: RepoRef, path?: string): Promise<GitCommit[]> {
    const log = await this.git(repo).log(path ? { file: path } : undefined);
    return log.all.map((c) => ({
      sha: c.hash,
      message: c.message,
      author: c.author_name,
      date: c.date,
    }));
  }

  /**
   * A file of the clone. The path comes from the repo's own content (diffs,
   * index), so it is confined to the clone: `..` segments and symlinks that
   * resolve outside it are refused rather than followed.
   */
  async readFile(repo: RepoRef, path: string): Promise<string> {
    const root = await realpath(this.clonePathFor(repo));
    const target = await realpath(resolve(root, path));
    if (target !== root && !target.startsWith(root + sep)) {
      throw new AppError('invalid_repo_path', `Path '${path}' is outside the repository`, 400);
    }
    return readFile(target, 'utf8');
  }
}

function parseBlamePorcelain(raw: string): BlameLine[] {
  const out: BlameLine[] = [];
  const lines = raw.split('\n');
  let sha = '';
  let author = '';
  let date = '';
  let summary = '';
  let lineNo = 0;
  for (const line of lines) {
    const header = line.match(/^([0-9a-f]{40})\s+\d+\s+(\d+)/);
    if (header) {
      sha = header[1]!;
      lineNo = Number(header[2]);
    } else if (line.startsWith('author ')) author = line.slice(7);
    else if (line.startsWith('author-time '))
      date = new Date(Number(line.slice(12)) * 1000).toISOString();
    else if (line.startsWith('summary ')) summary = line.slice(8);
    else if (line.startsWith('\t')) {
      out.push({ line: lineNo, sha, author, date, summary });
    }
  }
  return out;
}
