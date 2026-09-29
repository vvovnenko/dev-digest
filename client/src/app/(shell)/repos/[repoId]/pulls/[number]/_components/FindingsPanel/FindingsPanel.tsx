/* FindingsPanel — per-severity pills + severity filter + hide-low-confidence +
   j/k navigation + FindingCard list, wiring the accept/dismiss action hook (A2).
   Pills and filter only count/filter the findings already loaded — no request
   (server/specs/02-findings-by-severity.md, Amendment). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState, Chip, Icon, SEV } from "@devdigest/ui";
import type { FindingRecord, Severity } from "@devdigest/shared";
import { SEVERITY_LEVELS, countBySeverity } from "@/components/severity-counts";
import { FindingCard } from "../FindingCard";
import { useFindingAction, usePendingFindingIds } from "@/lib/hooks/reviews";
import { isShortcutFree } from "@/lib/shortcut-guards";
import { KEY_TO_ACTION } from "./constants";
import { visibleFindings } from "./helpers";
import { s } from "./styles";

export function FindingsPanel({
  findings,
  prId,
  shortcutsActive = true,
  repoFullName,
  headSha,
}: {
  findings: FindingRecord[];
  prId: string;
  /** Listen for j/k/a/d. With several runs open, only one panel does (FindingsTab decides). */
  shortcutsActive?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction(prId);
  const pendingIds = usePendingFindingIds(prId);
  const [hideLow, setHideLow] = React.useState(false);
  const [focusIdx, setFocusIdx] = React.useState(0);
  // One severity at a time; clicking the active filter again clears it.
  const [sevFilter, setSevFilter] = React.useState<Severity | null>(null);

  const counts = React.useMemo(() => countBySeverity(findings), [findings]);
  const presentLevels = SEVERITY_LEVELS.filter((sev) => counts[sev] > 0);
  const shown = React.useMemo(
    () => visibleFindings(findings, hideLow, sevFilter),
    [findings, hideLow, sevFilter],
  );

  const toggleSeverity = (sev: Severity) => {
    setSevFilter((cur) => (cur === sev ? null : sev));
    setFocusIdx(0);
  };

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    if (!shortcutsActive) return;
    const handler = (e: KeyboardEvent) => {
      // Plain keys only, and nothing behind an open drawer or dialog: Cmd/Ctrl+A
      // used to accept the focused finding and Cmd/Ctrl+D to reject it.
      if (!isShortcutFree(e)) return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      // Holding j/k scrolls; holding a/d must not fire the action again.
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx] && !e.repeat) {
        action.mutate({ findingId: shown[focusIdx]!.id, action: KEY_TO_ACTION[e.key]! });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shortcutsActive, shown, focusIdx, action]);

  return (
    <div>
      {presentLevels.length > 0 && (
        <div role="group" aria-label={t("panel.severityCounts")} style={s.pillRow}>
          {presentLevels.map((sev, i) => {
            const SevIcon = Icon[SEV[sev].icon];
            return (
              <React.Fragment key={sev}>
                {i > 0 && <span style={s.pillSep}>·</span>}
                <span style={s.pill(SEV[sev].c, SEV[sev].bg)}>
                  <SevIcon size={12} />
                  {t(`panel.pill.${sev}`, { count: counts[sev] })}
                </span>
              </React.Fragment>
            );
          })}
        </div>
      )}

      <div style={s.toolbar}>
        <div role="group" aria-label={t("panel.filterBySeverity")} style={s.filterGroup}>
          {SEVERITY_LEVELS.map((sev) => (
            <Chip
              key={sev}
              icon={SEV[sev].icon}
              color={SEV[sev].c}
              active={sevFilter === sev}
              onClick={() => toggleSeverity(sev)}
            >
              {t(`panel.filter.${sev}`)}
            </Chip>
          ))}
        </div>
        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focusIdx}
              defaultExpanded={i === 0}
              pending={pendingIds.has(f.id)}
              repoFullName={repoFullName}
              headSha={headSha}
              onAction={(act) => action.mutate({ findingId: f.id, action: act })}
            />
          ))
        )}
      </div>
    </div>
  );
}
