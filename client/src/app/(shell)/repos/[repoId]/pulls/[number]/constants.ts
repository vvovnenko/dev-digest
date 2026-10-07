import type { IconName } from "@devdigest/ui";
import type { Verdict } from "@devdigest/shared";

/** Constants for the PR detail route (/repos/:repoId/pulls/:number). */

/**
 * Per-verdict visual meta — the one owner for the Review-run header and the
 * VerdictBanner. `labelKey` resolves under `prReview.verdict`.
 */
export const VERDICT_META: Record<
  Verdict,
  { c: string; bg: string; icon: IconName; labelKey: string }
> = {
  request_changes: {
    c: "var(--crit)",
    bg: "var(--crit-bg)",
    icon: "XCircle",
    labelKey: "requestChanges",
  },
  approve: { c: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle", labelKey: "approve" },
  comment: { c: "var(--info)", bg: "var(--info-bg)", icon: "MessageSquare", labelKey: "comment" },
};

/** PR detail tabs (`?tab=`). */
export const TABS = ["overview", "findings", "diff"] as const;
export type PrTab = (typeof TABS)[number];
export const DEFAULT_TAB: PrTab = "overview";
