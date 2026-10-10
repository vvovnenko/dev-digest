import type { IntentConfidence, IntentSource } from "@devdigest/shared";

/** Badge colours per confidence level (design-system CSS variables). */
export const CONFIDENCE_COLOR: Record<IntentConfidence, { color: string; bg: string }> = {
  high: { color: "var(--ok)", bg: "var(--ok-bg)" },
  medium: { color: "var(--accent-text)", bg: "var(--accent-bg)" },
  low: { color: "var(--warn)", bg: "var(--warn-bg)" },
};

/** Source kinds the card lists: the linked documents, not the PR's own title, description and files. */
export const LINKED_SOURCE_KINDS: readonly IntentSource["kind"][] = ["issue", "pull", "repo_file", "url", "ticket"];
