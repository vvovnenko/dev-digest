/**
 * Review module constants.
 */

/**
 * Studio review strategy. 'single-pass' = send the WHOLE diff in ONE LLM call.
 * We deliberately do NOT use 'auto'/map-reduce by default: map-reduce makes one
 * call PER FILE, which is slow and fragile (any single file's transient 5xx
 * fails the entire run) and unnecessary — the whole diff already fits the
 * model's context.
 */
export const REVIEW_STRATEGY = 'single-pass' as const;

/**
 * How often an idle run-event stream sends an SSE comment. A long LLM call can
 * emit nothing for minutes; the comment keeps proxies and the socket from
 * timing the connection out.
 */
export const SSE_HEARTBEAT_MS = 15_000;

/**
 * The last event of a run's stream: the run is over and nothing else will come.
 * A stream that ends without it was cut (network, restart) — the client
 * reconnects, and de-duplicates the replayed events by `seq`.
 */
export const SSE_DONE_EVENT = 'done';

/** Default page of `GET /pulls/:id/runs` and `/pulls/:id/reviews` (max `MAX_PAGE`): far more runs than a PR collects. */
export const RUNS_PAGE = 500;
export const REVIEWS_PAGE = 500;
