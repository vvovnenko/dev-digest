import { z } from 'zod';
import { ConventionCategory } from '@devdigest/shared';
import type { ConventionScanStatus, ConventionStatus, ConventionUpdate, LLMUsage } from '@devdigest/shared';

/**
 * Conventions Extractor — the rules that turn a model's proposals into grounded
 * candidates and accepted candidates into one skill. Pure: the service reads the
 * files and calls the model, these functions only see paths, text and numbers.
 */

// ---- records ----------------------------------------------------------------

/** The repo a scan reads (the repos row satisfies it structurally). */
export interface ConventionRepo {
  id: string;
  owner: string;
  name: string;
  clonePath: string | null;
}

/** A stored candidate (the Drizzle row satisfies it structurally). Legacy columns are nullable. */
export interface ConventionRecord {
  id: string;
  workspaceId: string;
  repoId: string | null;
  category: ConventionCategory;
  rule: string;
  evidencePath: string | null;
  evidenceStartLine: number | null;
  evidenceEndLine: number | null;
  evidenceSnippet: string | null;
  confidence: number | null;
  accepted: boolean;
  status: ConventionStatus;
  fingerprint: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Why the evidence check refused a candidate. */
export type DropReason = 'bad_path' | 'file_missing' | 'line_out_of_range' | 'snippet_not_found';

export interface DroppedCandidate {
  rule: string;
  reason: DropReason;
}

/** One stored scan (the Drizzle row satisfies it structurally). The result fields are filled when it is `done`. */
export interface ConventionScanRecord {
  id: string;
  workspaceId: string;
  repoId: string;
  status: ConventionScanStatus;
  /** Why a `failed` scan failed. */
  error: string | null;
  /** The `jobs` row that runs it. */
  jobId: string | null;
  sampleFiles: string[];
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  candidatesFound: number;
  candidatesKept: number;
  dropped: { rule: string; reason: string }[];
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

/** A scan as `POST …/extract` queues it: on the model Settings picked for the workspace. */
export interface NewConventionScan {
  workspaceId: string;
  repoId: string;
  provider: string;
  model: string;
}

/** What a finished scan records; `candidatesKept` is what the store really added. */
export interface ConventionScanResult {
  sampleFiles: string[];
  tokensIn: number;
  tokensOut: number;
  costUsd: number | null;
  candidatesFound: number;
  dropped: { rule: string; reason: string }[];
}

/** What a failed scan records: why, and what its model call billed when the error says so. */
export interface ConventionScanFailure {
  error: string;
  usage?: LLMUsage | null;
}

/** A scan in these states holds the repo: at most one per repo (a partial unique index). */
export const ACTIVE_SCAN_STATUSES = ['queued', 'running'] as const satisfies readonly ConventionScanStatus[];

export const isActiveScan = (status: ConventionScanStatus): boolean =>
  (ACTIVE_SCAN_STATUSES as readonly ConventionScanStatus[]).includes(status);

/**
 * The `conventions-scan` job's payload. `repoId` also makes the JobRunner run
 * the scan after the same repo's clone / index / resync jobs, never beside them.
 */
export const ConventionScanJob = z.object({
  scanId: z.string().min(1),
  repoId: z.string().min(1),
  workspaceId: z.string().min(1),
});
export type ConventionScanJob = z.infer<typeof ConventionScanJob>;

/** A candidate that passed the evidence check: path and lines point at the real file. */
export interface VerifiedCandidate {
  category: ConventionCategory;
  rule: string;
  path: string;
  startLine: number;
  endLine: number;
  /** The file's own lines startLine..endLine, never the model's quote. */
  snippet: string;
  confidence: number;
}

/** A candidate ready to store: confidence clamped, rule normalised, fingerprinted. */
export interface FinalCandidate extends VerifiedCandidate {
  fingerprint: string;
}

/** Column values a status change or rule edit writes. */
export interface ConventionPatch {
  status?: ConventionStatus;
  accepted?: boolean;
  rule?: string;
}

// ---- the model's answer -----------------------------------------------------

/**
 * What the model returns. OpenAI strict json_schema mode: every field required,
 * `.nullable()` instead of `.optional()`, no min/max (confidence is clamped below).
 */
export const ConventionExtraction = z.object({
  candidates: z.array(
    z.object({
      category: ConventionCategory,
      rule: z.string(),
      evidence: z.object({
        file: z.string(),
        line: z.number().int(),
        end_line: z.number().int().nullable(),
        snippet: z.string(),
      }),
      confidence: z.number(),
    }),
  ),
});
export type ConventionExtraction = z.infer<typeof ConventionExtraction>;
export type ExtractedCandidate = ConventionExtraction['candidates'][number];

// ---- sampling ---------------------------------------------------------------

/** Config files whose settings are conventions in themselves; looked up by exact name. */
export const CONFIG_FILENAMES = [
  'tsconfig.json',
  'tsconfig.base.json',
  '.eslintrc',
  '.eslintrc.json',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.yml',
  '.eslintrc.yaml',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.js',
  '.prettierrc.cjs',
  '.prettierrc.yml',
  '.prettierrc.yaml',
  'prettier.config.js',
  'prettier.config.mjs',
  'prettier.config.cjs',
  '.editorconfig',
] as const;

/**
 * Where config files may sit: the repo root, then every ancestor directory of the
 * top files (shallowest first, in first-seen order), each with every config name.
 * Deduped; the caller reads them in this order and keeps the first few that exist.
 */
export function configCandidatePaths(topFiles: readonly string[]): string[] {
  const dirs: string[] = [''];
  for (const file of topFiles) {
    const path = normalizeEvidencePath(file);
    if (!path) continue;
    const parts = path.split('/').slice(0, -1);
    for (let depth = 1; depth <= parts.length; depth++) dirs.push(parts.slice(0, depth).join('/'));
  }
  const ordered = [...new Set(dirs)].sort((a, b) => depthOf(a) - depthOf(b));
  const out: string[] = [];
  for (const dir of ordered) for (const name of CONFIG_FILENAMES) out.push(dir ? `${dir}/${name}` : name);
  return [...new Set(out)];
}

const depthOf = (dir: string) => (dir === '' ? 0 : dir.split('/').length);

/**
 * A model-cited path → a repo-relative path, or null when it can't be one:
 * backslashes become `/`, a leading `./` goes, an absolute path or any `..`
 * segment is refused.
 */
export function normalizeEvidencePath(raw: string): string | null {
  let path = raw.trim().replace(/\\/g, '/');
  if (path === '' || path.startsWith('/') || /^[a-zA-Z]:\//.test(path)) return null;
  while (path.startsWith('./')) path = path.slice(2);
  path = path.replace(/\/{2,}/g, '/');
  const segments = path.split('/');
  if (segments.some((s) => s === '..')) return null;
  const clean = segments.filter((s) => s !== '' && s !== '.').join('/');
  return clean === '' ? null : clean;
}

// ---- line numbering ---------------------------------------------------------

/** A file's lines (a trailing newline does not add an empty last line). */
export function splitLines(content: string): string[] {
  const lines = content.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Lines with a right-aligned gutter, `  23| code`, as the model sees them. */
export function numberLines(lines: readonly string[], firstLine = 1): string {
  return lines.map((line, i) => `${String(firstLine + i).padStart(4)}| ${line}`).join('\n');
}

// ---- the evidence check -----------------------------------------------------

/** How far from the cited line the snippet may start before the whole file is searched. */
const LINE_DRIFT = 3;
/** The stored snippet is at most this many of the file's lines. */
const MAX_SNIPPET_LINES = 15;
/** A one-line snippet shorter than this (normalised) proves nothing. */
const MIN_SINGLE_LINE_CHARS = 8;
/** A snippet line at least this long may match part of a file line (the model cut it short). */
const MIN_PARTIAL_LINE_CHARS = 8;

/** A `  23| ` gutter the model copied from the prompt. */
const GUTTER = /^\s*\d+\s?\|\s?/;

const normalizeLine = (line: string) => line.trim().replace(/\s+/g, ' ');

function lineMatches(snippetLine: string, fileLine: string): boolean {
  if (snippetLine === fileLine) return true;
  return snippetLine.length >= MIN_PARTIAL_LINE_CHARS && fileLine.includes(snippetLine);
}

/**
 * The snippet's non-blank lines, normalised, with a copied gutter removed — the
 * gutter only when every non-blank line carries one, so code that starts with
 * `1 |` is left alone.
 */
function snippetLines(snippet: string): string[] {
  const raw = splitLines(snippet).filter((l) => l.trim() !== '');
  const gutter = raw.length > 0 && raw.every((l) => GUTTER.test(l));
  return raw.map((l) => normalizeLine(gutter ? l.replace(GUTTER, '') : l)).filter((l) => l !== '');
}

/** Where the snippet matches when its first line is file line `start` (0-based): the last matched index, or -1. */
function matchAt(fileLines: readonly string[], wanted: readonly string[], start: number): number {
  let i = start;
  for (let k = 0; k < wanted.length; k++) {
    // Blank file lines between the snippet's lines are skipped, never the first one.
    while (k > 0 && i < fileLines.length && fileLines[i] === '') i++;
    if (i >= fileLines.length || !lineMatches(wanted[k]!, fileLines[i]!)) return -1;
    i++;
  }
  return i - 1;
}

function locate(fileLines: readonly string[], wanted: readonly string[], cited: number): { start: number; end: number } | null {
  const near: number[] = [cited];
  for (let d = 1; d <= LINE_DRIFT; d++) near.push(cited - d, cited + d);
  for (const start of near) {
    if (start < 0 || start >= fileLines.length) continue;
    const end = matchAt(fileLines, wanted, start);
    if (end >= 0) return { start, end };
  }
  for (let start = 0; start < fileLines.length; start++) {
    const end = matchAt(fileLines, wanted, start);
    if (end >= 0) return { start, end };
  }
  return null;
}

/**
 * Ground each candidate in `files` (path → full content): the path must be a
 * repo path of a non-empty file, the cited line must exist, and the snippet —
 * whitespace-normalised, gutter stripped — must appear at the cited line ±3 or,
 * failing that, anywhere in the file (the candidate is then moved there). What
 * is kept carries the file's real lines; what is not, the reason.
 */
export function verifyCandidates(
  candidates: readonly ExtractedCandidate[],
  files: ReadonlyMap<string, string>,
): { kept: VerifiedCandidate[]; dropped: DroppedCandidate[] } {
  const kept: VerifiedCandidate[] = [];
  const dropped: DroppedCandidate[] = [];
  for (const c of candidates) {
    const drop = (reason: DropReason) => dropped.push({ rule: c.rule, reason });
    const path = normalizeEvidencePath(c.evidence.file);
    if (!path) {
      drop('bad_path');
      continue;
    }
    const content = files.get(path);
    if (!content) {
      drop('file_missing');
      continue;
    }
    const lines = splitLines(content);
    if (c.evidence.line < 1 || c.evidence.line > lines.length) {
      drop('line_out_of_range');
      continue;
    }
    const wanted = snippetLines(c.evidence.snippet);
    const tooShort = wanted.length === 1 && wanted[0]!.length < MIN_SINGLE_LINE_CHARS;
    const found = wanted.length > 0 && !tooShort ? locate(lines.map(normalizeLine), wanted, c.evidence.line - 1) : null;
    if (!found) {
      drop('snippet_not_found');
      continue;
    }
    const end = Math.min(found.end, found.start + MAX_SNIPPET_LINES - 1);
    kept.push({
      category: c.category,
      rule: c.rule,
      path,
      startLine: found.start + 1,
      endLine: end + 1,
      snippet: lines.slice(found.start, end + 1).join('\n'),
      confidence: c.confidence,
    });
  }
  return { kept, dropped };
}

// ---- finalising -------------------------------------------------------------

/** Candidates below this confidence are not shown. */
export const MIN_CONFIDENCE = 0.5;
/** At most this many new candidates per scan. */
export const MAX_CANDIDATES_PER_SCAN = 20;
/** The longest rule stored (the edit contract's limit). */
export const MAX_RULE_CHARS = 500;

/** One line, trimmed, at most MAX_RULE_CHARS. */
export function normalizeRule(rule: string): string {
  return rule.replace(/\s+/g, ' ').trim().slice(0, MAX_RULE_CHARS).trim();
}

/**
 * A rule's identity across scans: lowercased, whitespace collapsed, punctuation
 * stripped at both ends. Stored with the candidate and never changed by an edit,
 * so a re-scan can't bring back a rule the user already accepted or rejected.
 */
export function ruleFingerprint(rule: string): string {
  return rule
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '');
}

export const clampConfidence = (c: number) => (Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0);

/**
 * Verified candidates → what a scan stores: confidence clamped to 0..1, below
 * 0.5 dropped, one per fingerprint (the most confident), none the user already
 * decided (`decided` fingerprints), most confident first, at most 20.
 */
export function finalizeCandidates(
  verified: readonly VerifiedCandidate[],
  decided: ReadonlySet<string>,
): FinalCandidate[] {
  const ranked = verified
    .map((c) => ({ ...c, rule: normalizeRule(c.rule), confidence: clampConfidence(c.confidence) }))
    .filter((c) => c.confidence >= MIN_CONFIDENCE && c.rule !== '')
    .sort((a, b) => b.confidence - a.confidence);
  const seen = new Set<string>();
  const out: FinalCandidate[] = [];
  for (const c of ranked) {
    const fingerprint = ruleFingerprint(c.rule);
    if (fingerprint === '' || seen.has(fingerprint) || decided.has(fingerprint)) continue;
    seen.add(fingerprint);
    out.push({ ...c, fingerprint });
    if (out.length >= MAX_CANDIDATES_PER_SCAN) break;
  }
  return out;
}

/** A status change or rule edit → the columns to write; `accepted` always follows `status`. */
export function conventionPatch(update: ConventionUpdate): ConventionPatch {
  return {
    ...(update.status !== undefined ? { status: update.status, accepted: update.status === 'accepted' } : {}),
    ...(update.rule !== undefined ? { rule: normalizeRule(update.rule) } : {}),
  };
}

// ---- the skill draft --------------------------------------------------------

/** Words a rule slug leaves out: they say how strongly, not what. */
const SLUG_STOPWORDS = new Set([
  'a', 'all', 'always', 'an', 'and', 'are', 'as', 'be', 'by', 'every', 'for', 'from', 'goes', 'in',
  'instead', 'into', 'is', 'must', 'never', 'of', 'on', 'or', 'should', 'than', 'the', 'through', 'to',
  'use', 'uses', 'using', 'via', 'with',
]);
const MAX_SLUG_WORDS = 5;
const MAX_SLUG_CHARS = 60;
const FALLBACK_RULE_SLUG = 'convention';

/** "Always use async/await instead of .then() chains" → "async-await-then-chains". */
export function ruleSlug(rule: string): string {
  const words = rule
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== '' && !SLUG_STOPWORDS.has(w));
  const slug = words.slice(0, MAX_SLUG_WORDS).join('-').slice(0, MAX_SLUG_CHARS).replace(/-+$/g, '');
  return slug || FALLBACK_RULE_SLUG;
}

const MAX_SKILL_NAME_CHARS = 64;
const SKILL_NAME_SUFFIX = '-conventions';
const FALLBACK_REPO_SLUG = 'repo';

/** "Next.js_App" → "next-js-app-conventions": a valid skill name of at most 64 chars. */
export function skillNameFor(repoName: string): string {
  const slug =
    repoName
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, MAX_SKILL_NAME_CHARS - SKILL_NAME_SUFFIX.length)
      .replace(/-+$/g, '') || FALLBACK_REPO_SLUG;
  return `${slug}${SKILL_NAME_SUFFIX}`;
}

/** The longest skill body the contract accepts. */
export const MAX_SKILL_BODY_CHARS = 40_000;
/** Snippet line caps tried, longest first, until the body fits; 0 drops the snippet. */
const SNIPPET_LINE_STEPS = [15, 8, 4, 2, 1, 0];
/** A snippet line longer than this is cut in the skill body. */
const MAX_SNIPPET_LINE_CHARS = 240;

const LANGUAGES: Record<string, string> = {
  ts: 'ts', tsx: 'tsx', mts: 'ts', cts: 'ts', js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
  json: 'json', jsonc: 'json', py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  kt: 'kotlin', swift: 'swift', php: 'php', cs: 'csharp', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp',
  hpp: 'cpp', md: 'markdown', yml: 'yaml', yaml: 'yaml', toml: 'toml', sh: 'bash', bash: 'bash',
  css: 'css', scss: 'scss', html: 'html', sql: 'sql', vue: 'vue', svelte: 'svelte',
};
const DOTFILE_LANGUAGES: Record<string, string> = {
  '.editorconfig': 'ini',
  '.eslintrc': 'json',
  '.prettierrc': 'json',
};

/** A fenced block's language from the file name; '' when unknown. */
export function languageFor(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dotfile = DOTFILE_LANGUAGES[base];
  if (dotfile) return dotfile;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return LANGUAGES[base.slice(dot + 1).toLowerCase()] ?? '';
}

/** What a skill section cites. */
export interface AcceptedConvention {
  rule: string;
  evidencePath: string | null;
  evidenceStartLine: number | null;
  evidenceEndLine: number | null;
  evidenceSnippet: string | null;
}

/** `path:start-end`, or `path:start` for one line. */
export function evidenceLabel(c: AcceptedConvention): string {
  const path = c.evidencePath ?? '';
  const start = c.evidenceStartLine;
  if (start == null) return path;
  const end = c.evidenceEndLine ?? start;
  return end > start ? `${path}:${start}-${end}` : `${path}:${start}`;
}

function fenced(snippet: string, lang: string, maxLines: number): string {
  const lines = splitLines(snippet).slice(0, maxLines);
  const body = lines
    .map((l) => (l.length > MAX_SNIPPET_LINE_CHARS ? `${l.slice(0, MAX_SNIPPET_LINE_CHARS)}…` : l))
    .join('\n');
  // A snippet holding a fence of its own gets a longer one.
  const longest = Math.max(2, ...[...body.matchAll(/`{3,}/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${lang}\n${body}\n${fence}`;
}

function section(c: AcceptedConvention, slug: string, snippetLines: number): string {
  const head = `## ${slug}\n${normalizeRule(c.rule)}`;
  if (!c.evidencePath) return head;
  const detected = `Detected in \`${evidenceLabel(c)}\``;
  if (snippetLines === 0 || !c.evidenceSnippet) return `${head}\n\n${detected}.`;
  return `${head}\n\n${detected}:\n${fenced(c.evidenceSnippet, languageFor(c.evidencePath), snippetLines)}`;
}

/**
 * The fake LLM (and any diff-shaped reader) anchors on a line starting `+++ b/`;
 * a skill body must never contain one (server/INSIGHTS.md).
 */
const DIFF_HEADER = /^\+\+\+ b\//gm;
const defuseDiffHeaders = (text: string) => text.replace(DIFF_HEADER, ' +++ b/');

/** `n convention(s)`. */
export const conventionCount = (n: number) => `${n} ${n === 1 ? 'convention' : 'conventions'}`;

/** v1's note on a skill created from conventions. */
export function createdFromNote(acceptedCount: number, repoName: string): string {
  return `Created from ${conventionCount(acceptedCount)} in ${repoName}`;
}

/** The paths the accepted conventions cite, each once, in order. */
export function evidenceFilesOf(accepted: readonly AcceptedConvention[]): string[] {
  return [...new Set(accepted.map((c) => c.evidencePath).filter((p): p is string => !!p))];
}

/**
 * The accepted conventions merged into one skill: a `# <name>` heading, an intro
 * line, then per rule a `## <slug>` section with the rule, where it was detected
 * and the snippet. Snippets shrink until the body fits the 40,000-char limit;
 * sections that still don't fit are left out.
 */
export function buildSkillDraft(input: {
  repoName: string;
  accepted: readonly AcceptedConvention[];
}): { name: string; description: string; type: 'convention'; body: string } {
  const name = skillNameFor(input.repoName);
  const header =
    `# ${name}\n\nHouse conventions for \`${input.repoName}\`. ` +
    'Flag changes that violate any rule below and cite the offending `file:line`.';

  const used = new Map<string, number>();
  const slugs = input.accepted.map((c) => {
    const base = ruleSlug(c.rule);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });

  let body = header;
  for (const lines of SNIPPET_LINE_STEPS) {
    const sections = input.accepted.map((c, i) => defuseDiffHeaders(section(c, slugs[i]!, lines)));
    body = [header, ...sections].join('\n\n');
    if (body.length <= MAX_SKILL_BODY_CHARS) break;
    if (lines === 0) {
      body = header;
      for (const s of sections) {
        if (body.length + 2 + s.length > MAX_SKILL_BODY_CHARS) break;
        body = `${body}\n\n${s}`;
      }
    }
  }
  const n = input.accepted.length;
  return {
    name,
    description: `${n} house ${n === 1 ? 'convention' : 'conventions'} extracted from ${input.repoName}`,
    type: 'convention',
    body,
  };
}
