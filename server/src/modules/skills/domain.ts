import type {
  SkillImportSkipReason,
  SkillImportWarningCode,
  SkillSource,
  SkillType,
} from '@devdigest/shared';
import { SkillName, SkillType as SkillTypeSchema } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';

/**
 * Skills — rules for versions and for turning an uploaded file into a draft.
 * Pure: the repository applies the version rules inside its transaction, and the
 * import parser hands these functions plain values (paths, sizes, text).
 */

// ---- records ----------------------------------------------------------------

/** Everything about a skill that reaches the prompt — the part a version snapshots. */
export interface SkillContent {
  name: string;
  description: string;
  type: SkillType;
  body: string;
}

export type SkillContentField = keyof SkillContent;

/** A stored skill (the Drizzle row satisfies it structurally). */
export interface SkillRecord extends SkillContent {
  id: string;
  workspaceId: string;
  source: SkillSource;
  enabled: boolean;
  version: number;
  evidenceFiles: string[] | null;
  createdAt: Date;
}

/** One immutable snapshot in `skill_versions`. */
export interface SkillVersionRecord extends SkillContent {
  skillId: string;
  version: number;
  note: string;
  createdAt: Date;
}

/** Fields a write may change. */
export interface SkillPatch extends Partial<SkillContent> {
  enabled?: boolean;
}

/** What one write stores: the column values, plus the new version's snapshot when content changed. */
export interface SkillChange {
  set: Partial<SkillContent> & { enabled?: boolean; version?: number };
  snapshot: { version: number; note: string; content: SkillContent } | null;
}

// ---- versions ---------------------------------------------------------------

export const INITIAL_SKILL_VERSION = 1;

/** Notes list changed fields in this order, so "Edited body, description" reads the same every time. */
const NOTE_FIELD_ORDER: SkillContentField[] = ['body', 'description', 'name', 'type'];

/** The content fields `patch` changes relative to `current` (never `enabled`). */
export function contentChanges(current: SkillContent, patch: Partial<SkillContent>): SkillContentField[] {
  return NOTE_FIELD_ORDER.filter((k) => patch[k] !== undefined && patch[k] !== current[k]);
}

/** v1's note. */
export function createNote(importedFrom?: string): string {
  return importedFrom ? `Imported from ${importedFrom}` : 'Created';
}

/** "Edited body, description" — fields in a fixed order. */
export function editNote(fields: readonly SkillContentField[]): string {
  const ordered = NOTE_FIELD_ORDER.filter((f) => fields.includes(f));
  return `Edited ${ordered.join(', ')}`;
}

export function restoreNote(version: number): string {
  return `Restored v${version}`;
}

/**
 * Decide one write. A content change bumps the version and snapshots the new
 * content (with `note`, or an "Edited …" note); toggling `enabled` alone writes
 * no version. Null when the patch changes nothing.
 */
export function applySkillPatch(current: SkillRecord, patch: SkillPatch, note?: string): SkillChange | null {
  const changed = contentChanges(current, patch);
  const enabled = patch.enabled !== undefined && patch.enabled !== current.enabled ? patch.enabled : undefined;
  if (changed.length === 0 && enabled === undefined) return null;

  const set: SkillChange['set'] = {};
  for (const k of changed) Object.assign(set, { [k]: patch[k] });
  if (enabled !== undefined) set.enabled = enabled;
  if (changed.length === 0) return { set, snapshot: null };

  const version = current.version + 1;
  const content: SkillContent = {
    name: patch.name ?? current.name,
    description: patch.description ?? current.description,
    type: patch.type ?? current.type,
    body: patch.body ?? current.body,
  };
  return { set: { ...set, version }, snapshot: { version, note: note ?? editNote(changed), content } };
}

// ---- import: names ----------------------------------------------------------

export const FALLBACK_SKILL_NAME = 'imported-skill';
export const MAX_SKILL_NAME_CHARS = 64;
export const MAX_SKILL_DESCRIPTION_CHARS = 1024;
export const MAX_SKILL_BODY_CHARS = 40_000;
/** A body above this many estimated tokens gets a `large_body` warning. */
export const LARGE_SKILL_BODY_TOKENS = 4000;

export function isValidSkillName(name: string): boolean {
  return SkillName.safeParse(name).success;
}

/** Any text → a kebab-case slug (`"My Skill_v2"` → `"my-skill-v2"`); '' when nothing usable is left. */
export function slugifySkillName(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SKILL_NAME_CHARS)
    .replace(/-+$/g, '');
}

// ---- import: archive entries -----------------------------------------------

/** Script and binary extensions: listed as skipped, never read. */
export const SCRIPT_EXTENSIONS = new Set([
  'sh', 'bash', 'zsh', 'fish', 'py', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'rb', 'pl', 'php',
  'ps1', 'psm1', 'bat', 'cmd', 'exe', 'dll', 'so', 'dylib', 'jar', 'bin', 'wasm', 'app', 'command',
]);
export const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown']);
/** Frontmatter keys a skill uses; anything else (allowed-tools, license, …) is ignored with a warning. */
export const FRONTMATTER_KEYS: readonly string[] = ['name', 'description', 'type'];

export interface ArchiveEntry {
  path: string;
  /** Declared uncompressed size. */
  size: number;
}

export interface SkippedEntry {
  path: string;
  reason: SkillImportSkipReason;
}

export function extensionOf(path: string): string {
  const base = basenameOf(path);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function basenameOf(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

function isUnsafePath(path: string): boolean {
  return (
    path.startsWith('/') ||
    path.includes('\\') ||
    /^[A-Za-z]:/.test(path) ||
    path.split('/').some((seg) => seg === '..')
  );
}

function isOsMetadata(path: string): boolean {
  const base = basenameOf(path);
  return path.startsWith('__MACOSX/') || base === '.DS_Store' || base.startsWith('._');
}

function isScript(path: string): boolean {
  return path.split('/').slice(0, -1).includes('scripts') || SCRIPT_EXTENSIONS.has(extensionOf(path));
}

const isSkillMd = (path: string) => basenameOf(path).toLowerCase() === 'skill.md';
const depthOf = (path: string) => path.split('/').filter(Boolean).length;

/**
 * Pick the skill's core from an archive listing and say why every other entry is
 * left out. The core is the shallowest `SKILL.md`; failing that, the only
 * markdown file. Directory entries are dropped silently.
 */
export function classifyEntries(entries: readonly ArchiveEntry[]): { main: string; skipped: SkippedEntry[] } {
  const files = entries.filter((e) => !e.path.endsWith('/'));
  const usable = files.filter((e) => !isUnsafePath(e.path) && !isOsMetadata(e.path));

  const skillMds = usable.filter((e) => isSkillMd(e.path));
  let main: string | undefined;
  if (skillMds.length > 0) {
    const shallowest = Math.min(...skillMds.map((e) => depthOf(e.path)));
    const top = skillMds.filter((e) => depthOf(e.path) === shallowest);
    if (top.length > 1) {
      throw new ValidationError('The archive holds more than one SKILL.md at the same level', {
        reason: 'ambiguous_skill',
        files: top.map((e) => e.path),
      });
    }
    main = top[0]!.path;
  } else {
    const markdown = usable.filter((e) => MARKDOWN_EXTENSIONS.has(extensionOf(e.path)));
    if (markdown.length === 0) {
      throw new ValidationError('The archive has no SKILL.md or other markdown file', { reason: 'no_skill' });
    }
    if (markdown.length > 1) {
      throw new ValidationError('The archive has several markdown files and no SKILL.md — add a SKILL.md', {
        reason: 'ambiguous_skill',
        files: markdown.map((e) => e.path),
      });
    }
    main = markdown[0]!.path;
  }

  const skipped: SkippedEntry[] = [];
  for (const e of files) {
    if (e.path === main) continue;
    const reason: SkillImportSkipReason = isUnsafePath(e.path)
      ? 'unsafe_path'
      : isOsMetadata(e.path)
        ? 'os_metadata'
        : isScript(e.path)
          ? 'script'
          : MARKDOWN_EXTENSIONS.has(extensionOf(e.path))
            ? 'extra_markdown'
            : 'not_markdown';
    skipped.push({ path: e.path, reason });
  }
  return { main, skipped };
}

/**
 * Where a draft's name comes from when the frontmatter has none: the folder that
 * holds the core file, else the core file's own name (unless it is `SKILL.md`),
 * else the uploaded file's name.
 */
export function fallbackNameSource(mainPath: string, uploadName: string): string {
  const parts = mainPath.split('/').filter(Boolean);
  if (parts.length > 1) return parts[parts.length - 2]!;
  const stem = (p: string) => basenameOf(p).replace(/\.[^.]+$/, '');
  if (!isSkillMd(mainPath)) return stem(mainPath);
  return stem(uploadName);
}

// ---- import: text -----------------------------------------------------------

/**
 * Split a leading `---` YAML block from the markdown. Handles a BOM and CRLF.
 * `unterminated` = the text opens a block that never closes (then it is all body).
 */
export function splitFrontmatter(text: string): { frontmatter: string | null; body: string; unterminated: boolean } {
  const normalized = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (!/^---[ \t]*\n/.test(normalized)) return { frontmatter: null, body: normalized, unterminated: false };
  const lines = normalized.split('\n');
  for (let i = 1; i < lines.length; i++) {
    if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[i]!)) {
      return {
        frontmatter: lines.slice(1, i).join('\n'),
        body: lines.slice(i + 1).join('\n'),
        unterminated: false,
      };
    }
  }
  return { frontmatter: null, body: normalized, unterminated: true };
}

/** Zero-width characters, bidi controls and Unicode tag characters — invisible in a preview. */
const HIDDEN_CHARS = /[​-‍⁠﻿‪-‮⁦-⁩]|[\u{E0000}-\u{E007F}]/gu;

/** Invisible characters in `text`: how many, and on which (1-based) lines. */
export function findHiddenChars(text: string): { count: number; lines: number[] } {
  const lines = new Set<number>();
  let count = 0;
  text.split('\n').forEach((line, i) => {
    const hits = line.match(HIDDEN_CHARS);
    if (hits) {
      count += hits.length;
      lines.add(i + 1);
    }
  });
  return { count, lines: [...lines] };
}

export interface ImportWarning {
  code: SkillImportWarningCode;
  detail?: string | null;
}

export interface ImportDraft {
  draft: SkillContent;
  warnings: ImportWarning[];
}

/**
 * Turn parsed frontmatter + body into the draft the user confirms. Frontmatter
 * values that don't fit become warnings, never errors; an empty or oversized
 * body is an error (it could not be saved).
 */
export function buildImportDraft(input: {
  frontmatter: Record<string, unknown> | null;
  body: string;
  fallbackName: string;
  skipped: readonly SkippedEntry[];
  warnings?: readonly ImportWarning[];
}): ImportDraft {
  const fm = input.frontmatter ?? {};
  const warnings: ImportWarning[] = [...(input.warnings ?? [])];

  for (const key of Object.keys(fm)) {
    if (!FRONTMATTER_KEYS.includes(key)) {
      warnings.push({ code: 'unknown_frontmatter_key', detail: key });
    }
  }

  // name
  let name = '';
  if (typeof fm.name === 'string' && fm.name.trim()) {
    name = slugifySkillName(fm.name);
    if (name && name !== fm.name) warnings.push({ code: 'name_derived', detail: `"${fm.name}" → "${name}"` });
  } else if (fm.name !== undefined) {
    warnings.push({ code: 'invalid_frontmatter', detail: 'name is not text' });
  }
  if (!name) {
    name = slugifySkillName(input.fallbackName) || FALLBACK_SKILL_NAME;
    warnings.push({ code: 'name_derived', detail: `from "${input.fallbackName}"` });
  }

  // description
  let description = '';
  if (typeof fm.description === 'string') {
    description = fm.description.replace(/\s+/g, ' ').trim();
  } else if (fm.description !== undefined) {
    warnings.push({ code: 'invalid_frontmatter', detail: 'description is not text' });
  }
  if (description.length > MAX_SKILL_DESCRIPTION_CHARS) {
    description = description.slice(0, MAX_SKILL_DESCRIPTION_CHARS).trimEnd();
    warnings.push({
      code: 'invalid_frontmatter',
      detail: `description cut to ${MAX_SKILL_DESCRIPTION_CHARS} characters`,
    });
  }
  if (!description) warnings.push({ code: 'missing_description' });

  // type
  let type: SkillType = 'custom';
  if (fm.type !== undefined) {
    const parsed = SkillTypeSchema.safeParse(fm.type);
    if (parsed.success) type = parsed.data;
    else warnings.push({ code: 'invalid_type', detail: String(fm.type) });
  }

  // body
  const body = input.body.trim();
  if (!body) throw new ValidationError('The skill file has no instructions after its frontmatter', { reason: 'empty_body' });
  if (body.length > MAX_SKILL_BODY_CHARS) {
    throw new ValidationError(`The skill body is longer than ${MAX_SKILL_BODY_CHARS} characters`, {
      reason: 'body_too_long',
    });
  }
  const tokens = Math.ceil(body.length / 4);
  if (tokens > LARGE_SKILL_BODY_TOKENS) warnings.push({ code: 'large_body', detail: `≈${tokens} tokens` });

  const hidden = findHiddenChars(`${description}\n${body}`);
  if (hidden.count > 0) {
    // Line numbers are the body's own (the description takes the first line).
    const bodyLines = hidden.lines.filter((l) => l > 1).map((l) => l - 1);
    const where = bodyLines.length > 0 ? ` on line(s) ${bodyLines.join(', ')}` : ' in the description';
    warnings.push({ code: 'hidden_characters', detail: `${hidden.count} invisible character(s)${where}` });
  }

  for (const s of input.skipped) {
    if (s.reason === 'os_metadata' || s.reason === 'unsafe_path') continue;
    const short = s.path.split('/').slice(1).join('/');
    if (body.includes(s.path) || (short && body.includes(short))) {
      warnings.push({ code: 'skipped_file_referenced', detail: s.path });
    }
  }

  return { draft: { name, description, type, body }, warnings };
}
