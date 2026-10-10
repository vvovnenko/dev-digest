import type { IntentSource, PrIntentState } from "@devdigest/shared";
import { LINKED_SOURCE_KINDS } from "./constants";

/** The linked documents among an intent's sources, in the order they were read. */
export function linkedSources(sources: readonly IntentSource[]): IntentSource[] {
  return sources.filter((src) => LINKED_SOURCE_KINDS.includes(src.kind));
}

/** Whether a linked source could not be read (so the card marks it). */
export function isUnavailable(src: Pick<IntentSource, "status">): boolean {
  return src.status === "unavailable";
}

/** The message key under `intent.stale` for a stale reason (`staleGeneric` when none is given). */
export function staleKey(reason: PrIntentState["stale_reason"]): string {
  return reason ? `stale.${reason}` : "staleGeneric";
}
