/** Constants for the skills module. */

/** Largest upload `POST /skills/import/preview` reads (the contract's base64 cap decodes to this). */
export const MAX_IMPORT_BYTES = 512 * 1024;

/** An archive with more entries than this is refused before anything is inflated. */
export const MAX_ARCHIVE_ENTRIES = 100;

/** Refused when the entries' declared uncompressed sizes add up to more than this. */
export const MAX_ARCHIVE_UNCOMPRESSED = 2 * 1024 * 1024;

/** The skill's core markdown file (the only entry ever inflated) may be at most this big. */
export const MAX_MARKDOWN_BYTES = 256 * 1024;

/** Frontmatter longer than this is ignored (with a warning) instead of parsed. */
export const MAX_FRONTMATTER_CHARS = 8 * 1024;

/** YAML aliases allowed in frontmatter — a "billion laughs" block expands far beyond this. */
export const MAX_YAML_ALIASES = 10;

/** `GET /skills/:id/versions` page size. */
export const VERSIONS_PAGE = 100;
