import type { ConventionScan } from "@devdigest/shared";

/** Convention-scan rules shared by the data hook and the Conventions page. */

/**
 * Whether a scan is still in flight (`queued` or `running`): the conventions
 * state is polled and the page's actions stay locked until it isn't.
 */
export function isScanActive(scan: Pick<ConventionScan, "status"> | null | undefined): boolean {
  return scan?.status === "queued" || scan?.status === "running";
}
