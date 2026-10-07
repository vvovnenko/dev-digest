import { unzipSync } from 'fflate';
import { parse as parseYaml } from 'yaml';
import { ValidationError } from '../../platform/errors.js';
import {
  MARKDOWN_EXTENSIONS,
  buildImportDraft,
  classifyEntries,
  extensionOf,
  fallbackNameSource,
  firstHeading,
  slugifySkillName,
  splitFrontmatter,
  type ArchiveEntry,
  type ImportDraft,
  type ImportWarning,
  type SkippedEntry,
} from './domain.js';
import {
  MAX_ARCHIVE_ENTRIES,
  MAX_ARCHIVE_UNCOMPRESSED,
  MAX_FRONTMATTER_CHARS,
  MAX_IMPORT_BYTES,
  MAX_MARKDOWN_BYTES,
  MAX_YAML_ALIASES,
} from './constants.js';

/**
 * Turns an uploaded `.md` or `.zip` skill into a draft — in memory only. Nothing
 * from the upload is written to disk or executed: an archive is read in two
 * passes, the first over the central directory alone (no inflating), the second
 * inflating the ONE markdown file the draft comes from. Every other entry is
 * reported by name, with the reason it was left out.
 */

export interface ParsedUpload extends ImportDraft {
  /** The file (or archive entry) the draft's body came from. */
  sourceFile: string;
  skipped: SkippedEntry[];
}

/** Thrown from fflate's filter to stop walking a central directory that is too long. */
class TooManyEntries extends Error {}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const isZip = (bytes: Uint8Array) => ZIP_MAGIC.every((b, i) => bytes[i] === b);

export function parseSkillUpload(input: { filename: string; bytes: Uint8Array; preferHeadingName?: boolean }): ParsedUpload {
  const { filename, bytes, preferHeadingName: byHeading = false } = input;
  if (bytes.length === 0) throw new ValidationError('The file is empty', { reason: 'empty_file' });
  if (bytes.length > MAX_IMPORT_BYTES) {
    throw new ValidationError(`The file is larger than ${MAX_IMPORT_BYTES / 1024} KiB`, { reason: 'too_large' });
  }
  const ext = extensionOf(filename);
  if (ext === 'zip' || ext === 'skill' || isZip(bytes)) {
    if (!isZip(bytes)) throw new ValidationError('The file is not a zip archive', { reason: 'not_zip' });
    return parseArchive(filename, bytes, byHeading);
  }
  if (MARKDOWN_EXTENSIONS.has(ext)) {
    if (bytes.length > MAX_MARKDOWN_BYTES) {
      throw new ValidationError(`The markdown file is larger than ${MAX_MARKDOWN_BYTES / 1024} KiB`, {
        reason: 'too_large',
      });
    }
    return fromMarkdown(decodeUtf8(bytes), filename, fallbackNameSource(filename, filename), [], byHeading);
  }
  throw new ValidationError('Upload a .md file or a .zip skill folder', { reason: 'unsupported_type' });
}

function parseArchive(filename: string, bytes: Uint8Array, byHeading: boolean): ParsedUpload {
  // Pass 1 — names and declared sizes only; the filter refuses every entry, so nothing inflates.
  const entries: ArchiveEntry[] = [];
  try {
    unzipSync(bytes, {
      filter: (f) => {
        entries.push({ path: f.name, size: f.originalSize });
        if (entries.length > MAX_ARCHIVE_ENTRIES) throw new TooManyEntries();
        return false;
      },
    });
  } catch (err) {
    if (err instanceof TooManyEntries) {
      throw new ValidationError(`The archive has more than ${MAX_ARCHIVE_ENTRIES} entries`, {
        reason: 'too_many_entries',
      });
    }
    throw new ValidationError('The archive could not be read', { reason: 'corrupt_archive' });
  }
  const declared = entries.reduce((sum, e) => sum + e.size, 0);
  if (declared > MAX_ARCHIVE_UNCOMPRESSED) {
    throw new ValidationError(`The archive unpacks to more than ${MAX_ARCHIVE_UNCOMPRESSED / 1024 / 1024} MiB`, {
      reason: 'too_large',
    });
  }

  const { main, skipped } = classifyEntries(entries);
  const mainEntry = entries.find((e) => e.path === main)!;
  if (mainEntry.size > MAX_MARKDOWN_BYTES) {
    throw new ValidationError(`${main} is larger than ${MAX_MARKDOWN_BYTES / 1024} KiB`, { reason: 'too_large' });
  }

  // Pass 2 — inflate only the core file. fflate inflates into a buffer of the
  // DECLARED size, so a header that understates the size can't make it grow.
  let data: Uint8Array | undefined;
  try {
    data = unzipSync(bytes, { filter: (f) => f.name === main && f.originalSize <= MAX_MARKDOWN_BYTES })[main];
  } catch {
    throw new ValidationError(`${main} could not be unpacked`, { reason: 'corrupt_archive' });
  }
  if (!data) throw new ValidationError(`${main} could not be unpacked`, { reason: 'corrupt_archive' });

  return fromMarkdown(decodeUtf8(data), main, fallbackNameSource(main, filename), skipped, byHeading);
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ValidationError('The skill file is not valid UTF-8 text', { reason: 'not_text' });
  }
}

function fromMarkdown(
  text: string,
  sourceFile: string,
  fallbackName: string,
  skipped: SkippedEntry[],
  byHeading: boolean,
): ParsedUpload {
  const split = splitFrontmatter(text);
  const warnings: ImportWarning[] = [];
  if (split.unterminated) warnings.push({ code: 'invalid_frontmatter', detail: 'the --- block is never closed' });
  const frontmatter = split.frontmatter === null ? null : readFrontmatter(split.frontmatter, warnings);
  // `preferHeadingName` (URL import): with no usable frontmatter `name`, the first
  // `#` heading names the draft before the folder or file name does.
  const heading = byHeading ? firstHeading(split.body) : '';
  const fallback = heading && slugifySkillName(heading) ? heading : fallbackName;
  const draft = buildImportDraft({ frontmatter, body: split.body, fallbackName: fallback, skipped, warnings });
  return { ...draft, sourceFile, skipped };
}

/** YAML frontmatter → a plain object; anything unusable becomes a warning and is ignored. */
function readFrontmatter(source: string, warnings: ImportWarning[]): Record<string, unknown> | null {
  if (source.length > MAX_FRONTMATTER_CHARS) {
    warnings.push({ code: 'invalid_frontmatter', detail: `longer than ${MAX_FRONTMATTER_CHARS} characters` });
    return null;
  }
  let value: unknown;
  try {
    value = parseYaml(source, { maxAliasCount: MAX_YAML_ALIASES, logLevel: 'error' });
  } catch (err) {
    warnings.push({ code: 'invalid_frontmatter', detail: (err as Error).message.split('\n')[0]!.slice(0, 200) });
    return null;
  }
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    warnings.push({ code: 'invalid_frontmatter', detail: 'not a key: value block' });
    return null;
  }
  return value as Record<string, unknown>;
}
