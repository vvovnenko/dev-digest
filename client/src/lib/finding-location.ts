import type { FindingRecord } from "@devdigest/shared";

/** A finding's line range as the UI prints it: "11" for one line, "61-74" for a range. */
export function lineLabel(f: Pick<FindingRecord, "start_line" | "end_line">): string {
  return f.start_line === f.end_line ? `${f.start_line}` : `${f.start_line}-${f.end_line}`;
}
