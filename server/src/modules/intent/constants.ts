/** Constants for the intent module (the domain keeps the ones its rules need). */

/** `completeStructured` name for the classifier schema (also the mock LLM's fixture key). */
export const INTENT_SCHEMA_NAME = 'IntentClassification';

/** The JobRunner kind a derive runs as (`IntentService.runJob`). */
export const INTENT_JOB_KIND = 'pr-intent';

/**
 * Output cap per call. The model is picked in Settings → Models and may be a reasoning model, whose
 * hidden thinking counts against the cap (`finish_reason: length` cut deepseek scans off at 6000);
 * the JSON answer itself is ~300 tokens.
 */
export const INTENT_MAX_TOKENS = 8000;
export const INTENT_MAX_RETRIES = 1;

/**
 * The time budget of one derive stays under the JobRunner's 120 s job timeout (`platform/jobs.ts`),
 * which would otherwise record the job failed while the call keeps running:
 * refresh 15 + sources 15 (in parallel) + model 60 = 90 s.
 */
export const REFRESH_TIMEOUT_MS = 15_000;
export const SOURCE_TIMEOUT_MS = 15_000;
export const CLASSIFY_TIMEOUT_MS = 60_000;

/** A linked document reaches the model cut to this many characters (then it is `truncated`)… */
export const MAX_SOURCE_CHARS = 6000;
/** …and all linked documents together to this many. */
export const MAX_LINKED_CHARS = 24_000;
/** The largest URL body fetched. */
export const MAX_URL_BYTES = 256 * 1024;

/** The User-Agent of fetches for linked documents. */
export const INTENT_USER_AGENT = 'DevDigest-Intent/1.0';

/** Why an attempt a previous process left queued or running is failed on boot. */
export const INTERRUPTED_INTENT_ERROR = 'The API restarted while this intent was being derived';

/** `POST /pulls/:id/intent`: each request that queues an attempt is one paid model call. */
export const DERIVE_RATE_LIMIT = { max: 5, timeWindow: '1 minute' };
