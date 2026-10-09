import type { PrIntentState } from "@devdigest/shared";

/** Intent rules shared by the data hook and the Overview card. */

/**
 * Whether a derive attempt is still in flight (`queued` or `running`): the
 * intent state is polled and the card shows its "Deriving…" state.
 */
export function isIntentActive(status: PrIntentState["status"] | null | undefined): boolean {
  return status === "queued" || status === "running";
}
