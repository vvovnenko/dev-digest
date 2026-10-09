import { z } from 'zod';
import { IntentConfidence } from '@devdigest/shared';
import type {
  IntentSource,
  IntentSourceKind,
  PrIntentStaleReason,
  PrIntentStatus,
  UnifiedDiff,
} from '@devdigest/shared';

/**
 * Intent Layer — the rules that turn a PR's title, description and changed files into
 * a derived intent: which documents it links, how sure we can be, what is kept of
 * the model's answer, and when a stored intent has gone stale. Pure: the service
 * fetches and calls the model, these functions only see text and numbers.
 */

// ---- records ------------------------------------------------------------------

/** The PR an intent is derived for (the pulls row satisfies it structurally). */
export interface IntentPull {
  id: string;
  title: string;
  branch: string;
  base: string;
  headSha: string;
  /** The stored description; null until it was read from GitHub. */
  body: string | null;
  /** GitHub's number: the issues API takes it. */
  number: number;
}

/** The part of a PR a review run hands to the pre-work step (the reviews' `ReviewPull` satisfies it). */
export type IntentReviewPull = Pick<IntentPull, 'id' | 'title' | 'body' | 'headSha'>;

/** The PR's repo on GitHub. */
export interface IntentRepoRef {
  id: string;
  owner: string;
  name: string;
}

/** The attempt statuses that mean a job is on its way or running. */
export const ACTIVE_INTENT_STATUSES = ['queued', 'running'] as const;

export type IntentAttemptStatus = Exclude<PrIntentStatus, 'none'>;

/**
 * One stored `pr_intent` row (the Drizzle row satisfies it structurally). The result
 * fields (`intent` … `derivedAt`) are from the last successful derive; the rest from
 * the latest attempt.
 */
export interface IntentRecord {
  prId: string;
  workspaceId: string;
  status: IntentAttemptStatus;
  error: string | null;
  jobId: string | null;
  /** The summary; null until a derive succeeds. */
  intent: string | null;
  inScope: string[];
  outOfScope: string[];
  confidence: z.infer<typeof IntentConfidence> | null;
  sources: IntentSource[];
  missingContext: string[];
  headSha: string | null;
  inputHash: string | null;
  provider: string | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  requestedAt: Date;
  finishedAt: Date | null;
  derivedAt: Date | null;
}

/** An attempt as a request queues it: on the model Settings picked for the workspace. */
export interface NewIntentAttempt {
  workspaceId: string;
  prId: string;
  provider: string;
  model: string;
}

/** What a successful derive stores (field names are the row's). */
export interface IntentResult {
  intent: string;
  inScope: string[];
  outOfScope: string[];
  confidence: z.infer<typeof IntentConfidence>;
  sources: IntentSource[];
  missingContext: string[];
  headSha: string;
  inputHash: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
}

/** What a failed attempt records: why, and what the call billed before it failed. */
export interface IntentFailure {
  error: string;
  usage?: { tokensIn: number; tokensOut: number; costUsd: number | null } | null;
}

/** The `pr-intent` job payload. */
export const IntentJob = z.object({ workspaceId: z.string().min(1), prId: z.string().min(1) });
export type IntentJob = z.infer<typeof IntentJob>;

/** What the model answers (the structured-output schema of the classifier call). */
export const IntentClassification = z.object({
  summary: z
    .string()
    .describe('One or two sentences: what this PR sets out to do and why. Never empty, never "unknown".'),
  in_scope: z.array(z.string()).describe('What this PR is meant to change: files, modules, behaviours.'),
  out_of_scope: z
    .array(z.string())
    .describe('What this PR is not meant to touch. [] when nothing is clearly excluded.'),
  confidence: IntentConfidence.describe(
    'How sure you are: high = the description and linked documents state the goal; medium = only the description; low = inferred from the title, branch and files.',
  ),
  missing_context: z
    .array(z.string())
    .describe('Referenced documents you could not read. [] when none.'),
});
export type IntentClassification = z.infer<typeof IntentClassification>;

// ---- input normalisation and staleness ------------------------------------------

const MAX_TITLE_CHARS = 256;
const MAX_BODY_CHARS = 4000;

/**
 * The title and description exactly as they are compared and hashed: a missing body is
 * empty, line endings are LF, surrounding whitespace and anything past GitHub's / the
 * review prompt's limits are cut.
 */
export function normalizeIntentInput(input: { title: string; body: string | null }): { title: string; body: string } {
  const clean = (s: string) => s.replace(/\r\n?/g, '\n').trim();
  return {
    title: clean(input.title).slice(0, MAX_TITLE_CHARS),
    body: clean(input.body ?? '').slice(0, MAX_BODY_CHARS),
  };
}

/**
 * Has the PR moved on since the stored intent was derived? A new head wins over a
 * changed description. A stored input hash of null (a seeded row) is not compared.
 */
export function intentFreshness(
  stored: { headSha: string | null; inputHash: string | null } | null,
  current: { headSha: string; inputHash: string },
): { stale: boolean; reason: PrIntentStaleReason | null } {
  if (!stored) return { stale: false, reason: null };
  if (stored.headSha !== null && stored.headSha !== current.headSha) return { stale: true, reason: 'head_changed' };
  if (stored.inputHash !== null && stored.inputHash !== current.inputHash) {
    return { stale: true, reason: 'description_changed' };
  }
  return { stale: false, reason: null };
}

// ---- references -----------------------------------------------------------------

/** Documents a PR can link: a source kind that is fetched or looked up (not title, description, files). */
export type ReferenceKind = Exclude<IntentSourceKind, 'title' | 'description' | 'files'>;

/** What the service fetches for a pending reference. */
export type ReferenceTarget =
  | { type: 'issue'; owner: string; repo: string; number: number }
  | { type: 'repo_file'; path: string }
  | { type: 'url'; url: string };

/**
 * A link found in the PR's text. `pending` = to be fetched; `skipped` and `unavailable`
 * are final (`reason` is a code). `ref` is sanitized: no query, fragment or credentials.
 */
export interface Reference {
  kind: ReferenceKind;
  ref: string;
  status: 'pending' | 'skipped' | 'unavailable';
  reason: string | null;
  target: ReferenceTarget | null;
}

/** At most this many references are fetched; further distinct ones are skipped (`limit`). */
export const MAX_FETCHED_REFERENCES = 5;
/** Distinct references kept at all, so a hostile description can't grow the stored sources without bound. */
const MAX_REFERENCES = 20;

/** Uppercase prefixes that look like a ticket key but are standards, algorithms and the like. */
const NOT_TICKET_PREFIXES = new Set(['SHA', 'UTF', 'ISO', 'RFC', 'CVE', 'HTTP', 'TLS', 'AES', 'UTC']);

/** Text files a bare path or a URL may point to. */
const DOC_PATH = /\.(?:md|mdx|txt|rst|adoc)$/i;
const DOC_URL_PATH = /\.(?:md|markdown|txt)$/i;

const TICKET_KEY = /\b([A-Z][A-Z0-9]{1,9})-(\d+)\b/;

/** One scan over a text; alternatives are tried in this order at each position. */
const LINK_PATTERN = new RegExp(
  [
    String.raw`(?<url>https?:\/\/[^\s<>()\[\]"'` + '`' + String.raw`]+)`,
    String.raw`(?<xissue>(?<![\w/.-])(?<xowner>[A-Za-z0-9_.-]+)\/(?<xrepo>[A-Za-z0-9_.-]+)#(?<xnum>\d{1,9})\b)`,
    String.raw`(?<issue>(?<![\w&/])#(?<num>\d{1,9})\b)`,
    String.raw`(?<ticket>\b[A-Z][A-Z0-9]{1,9}-\d+\b)`,
    String.raw`(?<path>(?<![\w/.-])(?:[\w.-]+\/)*[\w.-]+\.(?:md|mdx|txt|rst|adoc)\b)`,
  ].join('|'),
  'g',
);

const sameRepo = (a: { owner: string; name: string }, owner: string, repo: string) =>
  a.owner.toLowerCase() === owner.toLowerCase() && a.name.toLowerCase() === repo.toLowerCase();

const ticketOf = (text: string): string | null => {
  const m = TICKET_KEY.exec(text);
  return m && !NOT_TICKET_PREFIXES.has(m[1]!) ? m[0] : null;
};

/** `host/path`, with no scheme, credentials, port, query or fragment. */
const hostPath = (url: URL) => `${url.hostname}${url.pathname}`;

function issueRef(repo: { owner: string; name: string }, owner: string, name: string, n: number): string {
  return sameRepo(repo, owner, name) ? `#${n}` : `${owner}/${name}#${n}`;
}

function fromUrl(raw: string, repo: { owner: string; name: string }): Reference | null {
  let url: URL;
  try {
    url = new URL(raw.replace(/[.,;:!?]+$/, ''));
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const skipped = (reason: string): Reference => ({
    kind: 'url',
    ref: hostPath(url),
    status: 'skipped',
    reason,
    target: null,
  });
  if (url.protocol === 'http:') return skipped('insecure');
  if (url.protocol !== 'https:') return null;

  if (host.endsWith('.atlassian.net') || host === 'linear.app') {
    const key = ticketOf(decodeURIComponent(url.pathname));
    return key ? ticketRef(key) : skipped('unsupported_type');
  }

  if (host === 'github.com' || host === 'www.github.com') {
    const [owner, name, section, ...rest] = url.pathname.split('/').filter(Boolean);
    if (owner && name && (section === 'issues' || section === 'pull') && /^\d{1,9}$/.test(rest[0] ?? '')) {
      const n = Number(rest[0]);
      return {
        kind: section === 'pull' ? 'pull' : 'issue',
        ref: issueRef(repo, owner, name, n),
        status: 'pending',
        reason: null,
        target: { type: 'issue', owner, repo: name, number: n },
      };
    }
    if (owner && name && section === 'blob' && rest.length >= 2) {
      const path = safeDecode(rest.slice(1).join('/'));
      if (!sameRepo(repo, owner, name)) {
        return { kind: 'repo_file', ref: `${owner}/${name}/${path}`, status: 'skipped', reason: 'other_repo', target: null };
      }
      return { kind: 'repo_file', ref: path, status: 'pending', reason: null, target: { type: 'repo_file', path } };
    }
    return skipped('unsupported_type');
  }

  if (!DOC_URL_PATH.test(url.pathname)) return skipped('unsupported_type');
  // Credentials and the fragment never go on the wire; the query may (signed links need it).
  const target = new URL(url.href);
  target.username = '';
  target.password = '';
  target.hash = '';
  return { kind: 'url', ref: hostPath(url), status: 'pending', reason: null, target: { type: 'url', url: target.href } };
}

function ticketRef(key: string): Reference {
  return { kind: 'ticket', ref: key, status: 'unavailable', reason: 'no_integration', target: null };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function scan(text: string, repo: { owner: string; name: string }, ticketsOnly: boolean, out: Reference[]): void {
  for (const m of text.matchAll(LINK_PATTERN)) {
    const g = m.groups ?? {};
    let found: Reference | null = null;
    if (ticketsOnly) {
      const key = g.ticket ? ticketOf(g.ticket) : null;
      if (key) found = ticketRef(key);
    } else if (g.url) {
      found = fromUrl(g.url, repo);
    } else if (g.xissue) {
      const n = Number(g.xnum);
      found = {
        kind: 'issue',
        ref: issueRef(repo, g.xowner!, g.xrepo!, n),
        status: 'pending',
        reason: null,
        target: { type: 'issue', owner: g.xowner!, repo: g.xrepo!, number: n },
      };
    } else if (g.issue) {
      const n = Number(g.num);
      found = {
        kind: 'issue',
        ref: `#${n}`,
        status: 'pending',
        reason: null,
        target: { type: 'issue', owner: repo.owner, repo: repo.name, number: n },
      };
    } else if (g.ticket) {
      const key = ticketOf(g.ticket);
      if (key) found = ticketRef(key);
    } else if (g.path && DOC_PATH.test(g.path)) {
      found = { kind: 'repo_file', ref: g.path, status: 'pending', reason: null, target: { type: 'repo_file', path: g.path } };
    }
    if (found) out.push(found);
  }
}

/**
 * The documents a PR links, in the order they appear: title, description, then the
 * branch name (Jira-style keys only). A link seen twice counts once. The first
 * {@link MAX_FETCHED_REFERENCES} that can be fetched stay `pending`; later ones are
 * `skipped` (`limit`). Nothing here touches the network.
 */
export function extractReferences(input: {
  title: string;
  body: string | null;
  branch: string;
  repo: { owner: string; name: string };
}): Reference[] {
  const found: Reference[] = [];
  scan(input.title, input.repo, false, found);
  scan(input.body ?? '', input.repo, false, found);
  scan(input.branch, input.repo, true, found);

  const seen = new Set<string>();
  const out: Reference[] = [];
  let pending = 0;
  for (const r of found) {
    if (seen.has(r.ref)) continue;
    seen.add(r.ref);
    if (out.length >= MAX_REFERENCES) break;
    if (r.status === 'pending' && ++pending > MAX_FETCHED_REFERENCES) {
      out.push({ ...r, status: 'skipped', reason: 'limit', target: null });
    } else {
      out.push(r);
    }
  }
  return out;
}

/**
 * The text of a file the PR adds whole (a single `@@ -0,0` hunk), read from the diff, so a
 * spec or plan that ships with the PR needs no GitHub call. Null for any other file.
 */
export function addedFileText(diff: UnifiedDiff, path: string): string | null {
  const file = diff.files.find((f) => f.path === path);
  const hunk = file?.hunks[0];
  if (!file || file.hunks.length !== 1 || !hunk || hunk.oldStart !== 0 || hunk.oldLines !== 0) return null;

  const lines = diff.raw.split('\n');
  const start = lines.findIndex((l) => l === `+++ b/${path}`);
  if (start < 0) return null;
  const text: string[] = [];
  let inHunk = false;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('diff --git ')) break;
    if (!inHunk) {
      inHunk = line.startsWith('@@');
    } else if (line.startsWith('+')) {
      text.push(line.slice(1));
    } else if (!line.startsWith('\\')) {
      break;
    }
  }
  return text.join('\n');
}

// ---- file outline ---------------------------------------------------------------

const OUTLINE_MAX_FILES = 200;
const OUTLINE_MAX_HUNKS_PER_FILE = 20;
const OUTLINE_MAX_CHARS = 8000;
const OUTLINE_MAX_HEADER_CHARS = 200;

/**
 * The shape of a diff and nothing else: per file its path and +added/-deleted counts,
 * then its `@@ … @@ context` hunk headers. No body line of the diff ever reaches the
 * classifier through here, so an empty description is read from structure, not code.
 */
export function fileOutline(raw: string): { text: string; files: number; hunks: number; truncated: boolean } {
  interface OutlineFile {
    path: string;
    added: number;
    deleted: number;
    headers: string[];
    hunks: number;
  }
  const parsed: OutlineFile[] = [];
  let current: OutlineFile | null = null;
  let inHunk = false;
  let minus: string | null = null;

  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const b = / b\/(.+)$/.exec(line);
      current = { path: b?.[1] ?? '', added: 0, deleted: 0, headers: [], hunks: 0 };
      parsed.push(current);
      inHunk = false;
      minus = null;
    } else if (!current) {
      continue;
    } else if (line.startsWith('@@')) {
      inHunk = true;
      current.hunks += 1;
      current.headers.push(line.slice(0, OUTLINE_MAX_HEADER_CHARS));
    } else if (inHunk) {
      if (line.startsWith('+')) current.added += 1;
      else if (line.startsWith('-')) current.deleted += 1;
    } else if (line.startsWith('--- a/')) {
      minus = line.slice('--- a/'.length);
    } else if (line.startsWith('+++ b/')) {
      current.path = line.slice('+++ b/'.length);
    } else if (line.startsWith('+++ /dev/null') && minus) {
      current.path = minus;
    }
  }

  const blocks: string[] = [];
  let size = 0;
  let files = 0;
  let hunks = 0;
  let truncated = false;
  for (const f of parsed) {
    if (!f.path) continue;
    const shown = f.headers.slice(0, OUTLINE_MAX_HUNKS_PER_FILE);
    const block = [`${f.path} (+${f.added} -${f.deleted})`, ...shown.map((h) => `  ${h}`)].join('\n');
    if (files >= OUTLINE_MAX_FILES || size + block.length + 1 > OUTLINE_MAX_CHARS) {
      truncated = true;
      break;
    }
    blocks.push(block);
    size += block.length + 1;
    files += 1;
    hunks += shown.length;
    if (f.headers.length > shown.length) truncated = true;
  }
  return { text: blocks.join('\n'), files, hunks, truncated };
}

// ---- confidence and the final intent ------------------------------------------

const LINK_KINDS: ReadonlySet<IntentSourceKind> = new Set(['issue', 'pull', 'repo_file', 'url', 'ticket']);
const FETCHED_KINDS: ReadonlySet<IntentSourceKind> = new Set(['issue', 'pull', 'repo_file', 'url']);
const RANK = { low: 0, medium: 1, high: 2 } as const;

/**
 * The most confidence the code allows (Amendment A2). An empty description is normal: the
 * intent is then read from the title, branch and files and is at most `low`, unless a
 * linked document was read. A description alone gives `medium`; `high` needs every
 * mentioned link read (and no ticket or skipped link missing).
 */
export function confidenceCap(sources: readonly IntentSource[]): 'high' | 'medium' | 'low' {
  const emptyDescription = sources.some((s) => s.kind === 'description' && s.status === 'skipped' && s.reason === 'empty');
  const linkedUsed = sources.some(
    (s) => FETCHED_KINDS.has(s.kind) && (s.status === 'used' || s.status === 'truncated'),
  );
  const linkedMissing = sources.some(
    (s) => LINK_KINDS.has(s.kind) && (s.status === 'unavailable' || s.status === 'skipped'),
  );
  if (emptyDescription && !linkedUsed) return 'low';
  if (linkedMissing || !linkedUsed) return 'medium';
  return 'high';
}

const MAX_SUMMARY_CHARS = 500;
const MAX_LIST_ITEMS = 8;
const MAX_LIST_ITEM_CHARS = 200;

const cleanList = (items: readonly string[]) =>
  items
    .map((i) => i.trim().slice(0, MAX_LIST_ITEM_CHARS))
    .filter((i) => i.length > 0)
    .slice(0, MAX_LIST_ITEMS);

/**
 * The model's classification made trustworthy: confidence is the lower of the model's and
 * the cap (the model can only lower it), `missing_context` is what code found unavailable
 * (never the model's own list), and text and lists are cut to what the review prompt shows.
 */
export function finalizeIntent(input: {
  classification: IntentClassification;
  sources: readonly IntentSource[];
}): {
  summary: string;
  in_scope: string[];
  out_of_scope: string[];
  confidence: 'high' | 'medium' | 'low';
  missing_context: string[];
} {
  const { classification: c, sources } = input;
  const cap = confidenceCap(sources);
  return {
    summary: c.summary.trim().slice(0, MAX_SUMMARY_CHARS),
    in_scope: cleanList(c.in_scope),
    out_of_scope: cleanList(c.out_of_scope),
    confidence: RANK[c.confidence] < RANK[cap] ? c.confidence : cap,
    missing_context: sources.filter((s) => s.status === 'unavailable').map((s) => `${s.ref}: ${s.reason ?? 'error'}`),
  };
}
