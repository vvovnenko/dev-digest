import type { Finding, Review, UnifiedDiff } from '@devdigest/shared';

/**
 * Reduce + slice helpers for map-reduce reviews. Pure (no DB / `this`), so they
 * live in the engine and are shared by the server and the CI runner.
 */

/**
 * Per-severity penalty subtracted from a perfect 100. Chosen so the score
 * tracks the findings the UI actually shows: 0 findings ⇒ 100, one suggestion
 * ⇒ 97, one warning ⇒ 88, one critical ⇒ 65.
 */
const SEVERITY_PENALTY: Record<Finding['severity'], number> = {
  CRITICAL: 35,
  WARNING: 12,
  SUGGESTION: 3,
};

/**
 * Deterministic 0–100 quality score derived from the (grounded) findings —
 * NOT the model's self-reported `score`, which has no anchor and drifts wildly
 * between models (a cheap model can "approve" with zero findings yet emit 10).
 * This mirrors how the review *event* is already computed from severities in
 * `to-review.ts`, so the number on screen can never contradict the findings
 * beneath it.
 */
export function scoreFromFindings(findings: Finding[]): number {
  const penalty = findings.reduce((sum, f) => sum + (SEVERITY_PENALTY[f.severity] ?? 0), 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

/** Verdict severity order for the reduce step (worst verdict wins). */
const VERDICT_RANK: Record<string, number> = {
  request_changes: 2,
  comment: 1,
  approve: 0,
};

/**
 * One finding per (file, lines, title): chunks overlap in context (repo map,
 * callers, PR description), so the model can report the same issue twice —
 * which would double its score penalty and its blocker count.
 */
export function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = JSON.stringify([f.file, f.start_line, f.end_line, f.title.trim().toLowerCase().replace(/\s+/g, ' ')]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Merge N partial Reviews (one per mapped file/chunk) into a single Review:
 * concat and de-duplicate findings, take the worst verdict, mean score, joined summaries.
 */
export function reduceReviews(partials: Review[]): Review {
  if (partials.length === 1) return { ...partials[0]!, findings: dedupeFindings(partials[0]!.findings) };
  const findings = dedupeFindings(partials.flatMap((p) => p.findings));
  let verdict: Review['verdict'] = 'approve';
  for (const p of partials) {
    if ((VERDICT_RANK[p.verdict] ?? 0) > (VERDICT_RANK[verdict] ?? 0)) verdict = p.verdict;
  }
  const score = partials.length
    ? Math.round(partials.reduce((s, p) => s + p.score, 0) / partials.length)
    : 0;
  const summary = partials.map((p) => p.summary).filter(Boolean).join(' ');
  return { verdict, score, summary, findings };
}

/**
 * Extract the slice of the unified diff for a single file (for map chunks).
 * Only the file's own `diff --git … b/<path>` block: a substring match would
 * also take `lib/x.ts` for `x.ts` (its header contains `b/x.ts` too). Returns
 * '' when the raw diff has no block for the path — the caller skips it.
 */
export function sliceDiff(diff: UnifiedDiff, path: string): string {
  const out: string[] = [];
  let capture = false;
  for (const line of diff.raw.split('\n')) {
    if (line.startsWith('diff --git ')) capture = line.endsWith(` b/${path}`);
    if (capture) out.push(line);
  }
  return out.join('\n');
}
