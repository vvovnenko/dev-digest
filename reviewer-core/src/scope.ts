import type { Finding, ReviewIntentContext } from '@devdigest/shared';

/**
 * Deterministic out-of-scope filter. The model only FLAGS a finding as
 * `out_of_scope`; this code decides what leaves the review — the model never
 * lowers a severity or drops a finding itself, and a PR description cannot
 * talk a real defect away.
 *
 * - no intent               → `none`: nothing dropped, a stray flag is reset.
 * - stale or `low` intent   → `tag-only`: the flags stay, nothing is dropped.
 * - otherwise               → `filter`: an out-of-scope WARNING / SUGGESTION is dropped; of
 *   the out-of-scope CRITICALs one stays (highest confidence, the first on a tie) so a real
 *   defect never vanishes, and the rest are dropped.
 */

export type ScopeMode = 'none' | 'filter' | 'tag-only';

export interface ScopeResult {
  kept: Finding[];
  dropped: { finding: Finding; reason: string }[];
  mode: ScopeMode;
}

export function applyIntentScope(findings: Finding[], intent?: ReviewIntentContext): ScopeResult {
  if (!intent) {
    // Without an intent the model had nothing to flag against: whatever it set is invented.
    return {
      kept: findings.map((f) => (f.out_of_scope ? { ...f, out_of_scope: false } : f)),
      dropped: [],
      mode: 'none',
    };
  }
  if (intent.stale || intent.confidence === 'low') {
    return { kept: findings, dropped: [], mode: 'tag-only' };
  }

  let signal: Finding | undefined;
  for (const f of findings) {
    if (f.out_of_scope === true && f.severity === 'CRITICAL' && (!signal || f.confidence > signal.confidence)) {
      signal = f;
    }
  }

  const kept: Finding[] = [];
  const dropped: ScopeResult['dropped'] = [];
  for (const f of findings) {
    if (f.out_of_scope !== true || f === signal) {
      kept.push(f);
    } else if (f.severity === 'CRITICAL') {
      dropped.push({ finding: f, reason: 'out of scope: another out-of-scope critical is kept as the signal' });
    } else {
      dropped.push({ finding: f, reason: 'out of scope of the PR intent' });
    }
  }
  return { kept, dropped, mode: 'filter' };
}
