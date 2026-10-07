import type { ConventionCandidate } from "@devdigest/shared";
import { CONFIDENCE_OK_MIN, CONFIDENCE_WARN_MIN } from "./constants";

/** Confidence 0..1 as the whole percent the card prints. */
export function confidencePercent(confidence: number): number {
  return Math.round(Math.max(0, Math.min(1, confidence)) * 100);
}

/** Bar colour for a confidence, judged on the printed percent so label and colour agree. */
export function confidenceColor(confidence: number): string {
  const pct = confidencePercent(confidence);
  if (pct >= CONFIDENCE_OK_MIN) return "var(--ok)";
  if (pct >= CONFIDENCE_WARN_MIN) return "var(--warn)";
  return "var(--crit)";
}

/** `path:start-end`, or `path:start` for a single line. */
export function evidenceLabel(
  c: Pick<ConventionCandidate, "evidence_path" | "evidence_start_line" | "evidence_end_line">,
): string {
  const { evidence_path: path, evidence_start_line: start, evidence_end_line: end } = c;
  return end > start ? `${path}:${start}-${end}` : `${path}:${start}`;
}

/** How many candidates are accepted (what "Create skill" would merge). */
export function acceptedCount(candidates: readonly Pick<ConventionCandidate, "status">[]): number {
  return candidates.filter((c) => c.status === "accepted").length;
}

/**
 * The "now" to print a past moment against: never before the moment itself, so
 * a scan that finished after the page's clock last ticked reads "now", not
 * "in 1 minute".
 */
export function relativeNow(at: Date, now: Date): Date {
  return at.getTime() > now.getTime() ? at : now;
}
