/** Constants for the conventions module (the domain keeps the ones its rules need). */

/** Top-ranked source files a scan samples (`repoIntel.getConventionSamples`). */
export const TOP_FILES = 12;

/** At most this many config files (tsconfig, eslint, prettier, editorconfig) are sampled. */
export const MAX_CONFIG_FILES = 6;

/** Each sampled file reaches the model cut to this many lines… */
export const MAX_FILE_LINES = 250;

/** …and this many characters of numbered text. */
export const MAX_FILE_CHARS = 12_000;

/** The sampled files together stay under this many characters; later files are cut or left out. */
export const MAX_PROMPT_CHARS = 90_000;

/** A file is left out rather than cut below this many characters. */
export const MIN_FILE_CHARS = 500;

/** The model is asked for at most this many candidates. */
export const MAX_CANDIDATES_ASKED = 15;

/** Already accepted or rejected rules listed in the prompt as "don't repeat". */
export const MAX_DECIDED_IN_PROMPT = 30;

/** `completeStructured` name for the extraction schema (also the mock LLM's fixture key). */
export const EXTRACTION_SCHEMA_NAME = 'ConventionExtraction';

/**
 * Output cap per call. The default model (deepseek-v4-flash) reasons before it
 * answers, and that hidden thinking counts against the cap: scans measured
 * 4.8K-8.9K completion tokens (2.2K-4.7K+ of them reasoning, ~2.5K of JSON for
 * 15 candidates), so 6000 cut scans off (`finish_reason: length`). It ignores
 * OpenRouter's `reasoning.effort`.
 */
export const EXTRACTION_MAX_TOKENS = 12_000;
export const EXTRACTION_MAX_RETRIES = 1;

/**
 * The model call's abort. It must settle before the JobRunner's 120 s job
 * timeout (`platform/jobs.ts`), which otherwise records the job failed and
 * stops waiting while the call keeps running. Scans measured 36-84 s.
 */
export const EXTRACTION_TIMEOUT_MS = 110_000;

/** The JobRunner kind a scan runs as (`ConventionsService.runScan`). */
export const CONVENTIONS_SCAN_JOB_KIND = 'conventions-scan';

/** Why a scan a previous process left queued or running is failed on boot. */
export const INTERRUPTED_SCAN_ERROR = 'The API restarted while this scan was running';

/** `POST /repos/:id/conventions/extract`: each scan it queues is one paid model call. */
export const EXTRACT_RATE_LIMIT = { max: 5, timeWindow: '1 minute' };
