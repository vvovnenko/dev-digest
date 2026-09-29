import type { PrMeta } from '@devdigest/shared';

/**
 * The newest `updated_at` among the PRs a poll imported — the next poll reads
 * GitHub only down to it. Null when the poll saw no PR with a timestamp, so the
 * stored watermark stays.
 */
export function newestUpdate(pulls: Pick<PrMeta, 'updated_at'>[]): Date | null {
  let newest: number | null = null;
  for (const { updated_at } of pulls) {
    const at = updated_at ? Date.parse(updated_at) : Number.NaN;
    if (!Number.isNaN(at) && (newest === null || at > newest)) newest = at;
  }
  return newest === null ? null : new Date(newest);
}

/**
 * Which PRs get fresh diff stats this poll, at most `limit`: first the ones the
 * poll saw change (in the order GitHub listed them, most recently updated first
 * — new commits change the diff), then those still without stats.
 */
export function statsTargets(seen: number[], lacking: number[], limit: number): number[] {
  return [...new Set([...seen, ...lacking])].slice(0, limit);
}
