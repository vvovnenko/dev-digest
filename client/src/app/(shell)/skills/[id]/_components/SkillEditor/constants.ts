import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `skills` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/**
 * The skill editor's tabs (Context / Evals are later lessons). Stats is hidden
 * until HW8: `StatsTab` is kept — re-add `{ key: "stats", labelKey:
 * "editor.tabs.stats", icon: "BarChart" }` here and `"stats"` in `VALID_TABS`.
 */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "preview", labelKey: "editor.tabs.preview", icon: "Eye" },
  { key: "versions", labelKey: "editor.tabs.versions", icon: "History" },
];
