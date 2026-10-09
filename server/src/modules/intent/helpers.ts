import type { PrIntentRecord, PrIntentState } from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';
import { TimeoutError } from '../../platform/resilience.js';
import type { IntentRecord } from './domain.js';

/** A stored row as the API shows it. `stale` is judged by the caller against the PR; a PR never derived is `none`. */
export function toStateDto(
  prId: string,
  row: IntentRecord | undefined,
  freshness: Pick<PrIntentState, 'stale' | 'stale_reason'>,
): PrIntentState {
  if (!row) {
    return {
      pr_id: prId,
      status: 'none',
      error: null,
      stale: false,
      stale_reason: null,
      intent: null,
      provider: null,
      model: null,
      tokens_in: null,
      tokens_out: null,
      cost_usd: null,
      requested_at: null,
      finished_at: null,
    };
  }
  return {
    pr_id: prId,
    status: row.status,
    error: row.error,
    stale: freshness.stale,
    stale_reason: freshness.stale_reason,
    intent: toRecordDto(row),
    provider: row.provider,
    model: row.model,
    tokens_in: row.tokensIn,
    tokens_out: row.tokensOut,
    cost_usd: row.costUsd,
    requested_at: row.requestedAt.toISOString(),
    finished_at: row.finishedAt?.toISOString() ?? null,
  };
}

/** The last successful result of the row; null while no derive has succeeded. */
export function toRecordDto(row: IntentRecord): PrIntentRecord | null {
  if (row.intent === null || row.confidence === null || row.derivedAt === null) return null;
  return {
    pr_id: row.prId,
    summary: row.intent,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    confidence: row.confidence,
    sources: row.sources,
    missing_context: row.missingContext,
    head_sha: row.headSha,
    derived_at: row.derivedAt.toISOString(),
  };
}

/** Why a GitHub call for a linked issue or file failed, as a code: never the error's own text. */
export function githubReason(err: unknown): string {
  if (err instanceof TimeoutError) return 'timeout';
  const status = (err as { status?: number } | null)?.status;
  if (status === 404) return 'not_found';
  if (status === 401 || status === 403) return 'forbidden';
  return 'error';
}

/** Why fetching a linked URL failed, as a code: the safe-fetch adapter's `details.reason`, never its message. */
export function fetchReason(err: unknown): string {
  if (err instanceof TimeoutError) return 'timeout';
  const details = err instanceof AppError ? (err.details as { reason?: string; status?: number } | undefined) : undefined;
  switch (details?.reason) {
    case 'blocked_address':
    case 'insecure_redirect':
      return 'blocked';
    case 'too_large':
      return 'too_large';
    case 'html_page':
    case 'invalid_url':
      return 'unsupported_type';
    case 'timeout':
      return 'timeout';
    case 'upstream_status':
      return details.status === 404 ? 'not_found' : details.status === 401 || details.status === 403 ? 'forbidden' : 'error';
    default:
      return 'error';
  }
}

export const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));
