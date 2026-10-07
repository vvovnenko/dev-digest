/**
 * What the code parsers handle — shared by the ast-grep and dependency-graph
 * adapters and the repo-intel indexer (which re-exports these from its
 * constants), so no adapter has to reach into a feature module.
 */

/** Files we parse. */
export const SUPPORTED_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const;

/** Signatures are trimmed to this many chars in the parse phase (cache stability). */
export const MAX_SIGNATURE_CHARS = 120;
