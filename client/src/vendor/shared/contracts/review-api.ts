import { z } from 'zod';
import { Finding, Verdict } from './findings.js';
import { Intent, IntentConfidence, IntentSource, SmartDiff } from './brief.js';

/**
 * A2 — Review-Core API surface contracts. These extend the core
 * Review/Finding/Intent/SmartDiff contracts with the persisted/transport shapes
 * the reviewer endpoints return. A2 owns this file; the barrel re-exports it.
 *
 * Distinct from `Finding` (the raw LLM-output unit): `FindingRecord` adds the
 * persisted row identity + action timestamps so the UI can render accept/dismiss
 * state and the `review_id` it belongs to.
 */

export const FindingRecord = Finding.extend({
  review_id: z.string(),
  accepted_at: z.string().nullable(),
  dismissed_at: z.string().nullable(),
});
export type FindingRecord = z.infer<typeof FindingRecord>;

/** A persisted review with its kept findings + grounding summary. */
export const ReviewRecord = z.object({
  id: z.string(),
  pr_id: z.string(),
  agent_id: z.string().nullable(),
  run_id: z.string().nullable(),
  agent_name: z.string().nullish(),
  kind: z.enum(['summary', 'review']),
  verdict: Verdict.nullable(),
  summary: z.string().nullable(),
  score: z.number().int().nullable(),
  model: z.string().nullable(),
  grounding: z.string().nullish(),
  // Usage of the run that produced this review (null = unknown / no run).
  cost_usd: z.number().nullish(),
  tokens_in: z.number().int().nullish(),
  tokens_out: z.number().int().nullish(),
  created_at: z.string(),
  findings: z.array(FindingRecord),
});
export type ReviewRecord = z.infer<typeof ReviewRecord>;

/**
 * Response of `POST /pulls/:id/review`. Each requested agent produces a run that
 * streams over SSE at `/runs/:runId/events`; clients subscribe per run. Runs are
 * fire-and-forget, so `reviews` is always `[]`: read `GET /pulls/:id/reviews` once
 * they finish.
 */
export const ReviewRunTarget = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
});
export type ReviewRunTarget = z.infer<typeof ReviewRunTarget>;

export const ReviewRunResponse = z.object({
  pr_id: z.string(),
  runs: z.array(ReviewRunTarget),
  reviews: z.array(ReviewRecord),
});
export type ReviewRunResponse = z.infer<typeof ReviewRunResponse>;

/** Intent persisted for a PR: the Intent plus how it was derived (from the last successful derive). */
export const PrIntentRecord = Intent.extend({
  pr_id: z.string(),
  confidence: IntentConfidence,
  sources: z.array(IntentSource),
  missing_context: z.array(z.string()),
  head_sha: z.string().nullable(),
  derived_at: z.string(),
});
export type PrIntentRecord = z.infer<typeof PrIntentRecord>;

/** Status of the latest derive attempt; `none` = never derived. */
export const PrIntentStatus = z.enum(['none', 'queued', 'running', 'done', 'failed']);
export type PrIntentStatus = z.infer<typeof PrIntentStatus>;

export const PrIntentStaleReason = z.enum(['head_changed', 'description_changed']);
export type PrIntentStaleReason = z.infer<typeof PrIntentStaleReason>;

/**
 * Response of `GET`/`POST /pulls/:id/intent`. `intent` is the last successful result and
 * survives a failed re-derive; `status`/`error`/usage describe the latest attempt.
 */
export const PrIntentState = z.object({
  pr_id: z.string(),
  status: PrIntentStatus,
  error: z.string().nullable(),
  stale: z.boolean(),
  stale_reason: PrIntentStaleReason.nullable(),
  intent: PrIntentRecord.nullable(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  requested_at: z.string().nullable(),
  finished_at: z.string().nullable(),
});
export type PrIntentState = z.infer<typeof PrIntentState>;

/** Smart-diff response for a PR (the SmartDiff). */
export const SmartDiffResponse = SmartDiff;
export type SmartDiffResponse = z.infer<typeof SmartDiffResponse>;
