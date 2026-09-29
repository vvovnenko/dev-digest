import { type Repo } from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';
import { GITHUB_HOST, GITHUB_SSH_URL_REGEX, REPO_SEGMENT_REGEX } from './constants.js';
import type { RepoRecord } from './domain.js';

/**
 * F1 — repos pure helpers (extracted from routes.ts; no behaviour change).
 * Pure functions only — no I/O, no DB, no container.
 */

/**
 * Parse `owner`/`name` from a GitHub repo URL: `https://github.com/owner/repo(.git)(/)`
 * or `git@github.com:owner/repo(.git)`. Anything else is rejected — another host or
 * protocol, credentials, a port, a query, extra path segments, `.`/`..` — because the
 * segments become a filesystem path and git never sees the user's URL: the clone URL
 * is rebuilt from them (`canonicalCloneUrl`).
 */
export function parseRepoUrl(url: string): { owner: string; name: string } {
  const segments = githubPathSegments(url.trim());
  const owner = segments?.[0];
  const name = segments?.[1]?.replace(/\.git$/, '');
  if (
    segments?.length !== 2 ||
    !owner ||
    !name ||
    !REPO_SEGMENT_REGEX.test(owner) ||
    !REPO_SEGMENT_REGEX.test(name)
  ) {
    throw new AppError('invalid_repo_url', `Could not parse owner/repo from '${url}'`, 422);
  }
  return { owner, name };
}

/** The path segments of a github.com URL, or null when it isn't one we accept. */
function githubPathSegments(url: string): string[] | null {
  const ssh = url.match(GITHUB_SSH_URL_REGEX);
  if (ssh) return [ssh[1]!, ssh[2]!];
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const plain =
    u.protocol === 'https:' &&
    u.hostname === GITHUB_HOST &&
    !u.port &&
    !u.username &&
    !u.password &&
    !u.search &&
    !u.hash;
  // URL has already resolved `.`/`..` and percent-encoded dots in the pathname.
  return plain ? u.pathname.replace(/^\/+|\/+$/g, '').split('/') : null;
}

/** The only URL a repo is cloned from — never the user's input, never with a token. */
export function canonicalCloneUrl(owner: string, name: string): string {
  return `https://${GITHUB_HOST}/${owner}/${name}.git`;
}

/** Map a persisted repo row to the API `Repo` DTO. */
export function toRepoDto(row: RepoRecord): Repo {
  return {
    id: row.id,
    workspace_id: row.workspaceId,
    owner: row.owner,
    name: row.name,
    full_name: row.fullName,
    default_branch: row.defaultBranch,
    clone_path: row.clonePath,
    last_polled_at: row.lastPolledAt?.toISOString() ?? null,
    created_by: row.createdBy,
  };
}
