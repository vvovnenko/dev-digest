/**
 * GitHub auth for git subprocesses that never persists the token. The PAT goes in
 * as a per-command `-c http.<origin>.extraheader` (the scheme actions/checkout
 * uses), never into a remote URL — a URL with credentials is stored verbatim in
 * the clone's `.git/config`.
 */

/** Requests to this origin get the auth header; no other host ever sees the token. */
export const GITHUB_HTTPS_ORIGIN = 'https://github.com/';

/** `-c` entry that authenticates https requests to github.com with a PAT. */
export function githubAuthConfig(token: string): string {
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return `http.${GITHUB_HTTPS_ORIGIN}.extraheader=AUTHORIZATION: basic ${basic}`;
}

/** A remote URL without an embedded user/password (older clones stored the PAT there). */
export function withoutCredentials(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url; // scp-like ssh form (`git@host:path`) carries no password
  }
  if (!u.username && !u.password) return url;
  u.username = '';
  u.password = '';
  return u.toString();
}
