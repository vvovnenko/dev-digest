/**
 * F1 — repos module constants (extracted from routes.ts; no behaviour change).
 */

/** JobRunner kind for the asynchronous `git clone` job. */
export const CLONE_JOB_KIND = 'clone';

/** Clone depth — shallow clone (latest commit only) keeps imports fast. */
export const CLONE_DEPTH = 1;

/** The only host a repo URL may point at; clones always use `https://github.com/<owner>/<name>.git`. */
export const GITHUB_HOST = 'github.com';

/**
 * One owner or repo-name segment as GitHub allows it: letters, digits, `.`, `_`, `-`,
 * never `.` or `..`. The segments become the clone path `<cloneDir>/<owner>/<name>`,
 * so this is a path-safety check as well as a format check.
 */
export const REPO_SEGMENT_REGEX = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;

/** The SSH form `git@github.com:owner/repo(.git)`, matched in full. */
export const GITHUB_SSH_URL_REGEX = /^git@github\.com:([^/]+)\/([^/]+)$/;
