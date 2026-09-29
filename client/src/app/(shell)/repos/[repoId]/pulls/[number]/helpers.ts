import type { FindingRecord, ReviewRecord, RunSummary } from "@devdigest/shared";
import { DEFAULT_TAB, TABS, type PrTab } from "./constants";

/** Ids of the runs still in flight, from the run history. */
export function liveRunIds(runs: RunSummary[] | undefined): string[] {
  return (runs ?? []).filter((r) => r.status === "running").map((r) => r.run_id);
}

/** Every finding of every review, newest review first. */
export function allFindings(reviews: ReviewRecord[]): FindingRecord[] {
  return reviews.flatMap((r) => r.findings);
}

/** A `?tab=` value, or the default when missing or unknown. */
export function parseTab(value: string | null): PrTab {
  return (TABS as readonly string[]).includes(value ?? "") ? (value as PrTab) : DEFAULT_TAB;
}
