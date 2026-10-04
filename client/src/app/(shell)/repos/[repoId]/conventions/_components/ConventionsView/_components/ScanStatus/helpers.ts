import type { ConventionScan } from "@devdigest/shared";

/** What the status line says about the newest scan. */
export type ScanNotice =
  | { kind: "queued" }
  /** `since`: when it started (its creation while `started_at` is unset). */
  | { kind: "running"; since: string }
  /** `error`: the server's reason, or null when it gave none. */
  | { kind: "failed"; error: string | null };

/**
 * The status line for the newest scan (`latest`): queued, running, or failed —
 * the last only while it is newer than the done scan the cards came from
 * (`done`). Null when there is nothing to say.
 */
export function scanNotice(done: ConventionScan | null, latest: ConventionScan | null): ScanNotice | null {
  if (!latest) return null;
  if (latest.status === "queued") return { kind: "queued" };
  if (latest.status === "running") return { kind: "running", since: latest.started_at ?? latest.created_at };
  if (latest.status === "failed" && latest.id !== done?.id) {
    return { kind: "failed", error: latest.error?.trim() || null };
  }
  return null;
}
