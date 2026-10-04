/* ScanStatus — the line under the Conventions subtitle about the newest scan:
   queued, running ("started …", re-printed every second by its own clock so the
   cards don't re-render with it), or failed with the reason while that failure
   is newer than the scan the cards came from. Renders nothing otherwise. */
"use client";

import { useFormatter, useNow, useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { ConventionScan } from "@devdigest/shared";
import { relativeNow } from "../../../../helpers";
import { RUNNING_TICK_MS } from "./constants";
import { scanNotice } from "./helpers";
import { s } from "./styles";

export function ScanStatus({
  scan,
  latest,
}: {
  /** The latest done scan (what the cards came from). */
  scan: ConventionScan | null;
  /** The newest scan of any status. */
  latest: ConventionScan | null;
}) {
  const t = useTranslations("conventions");
  const format = useFormatter();
  const notice = scanNotice(scan, latest);
  const now = useNow({ updateInterval: notice?.kind === "running" ? RUNNING_TICK_MS : undefined });

  if (!notice) return null;
  if (notice.kind === "failed") {
    return (
      <p role="status" style={s.line("var(--crit)")}>
        <Icon.AlertTriangle size={14} style={s.icon} />
        <span>{notice.error ? t("status.failed", { error: notice.error }) : t("status.failedFallback")}</span>
      </p>
    );
  }
  if (notice.kind === "queued") {
    return (
      <p role="status" style={s.line("var(--text-secondary)")}>
        <Icon.Clock size={14} style={s.icon} />
        <span>{t("status.queued")}</span>
      </p>
    );
  }
  const since = new Date(notice.since);
  return (
    <p role="status" style={s.line("var(--text-secondary)")}>
      <Icon.RefreshCw size={14} style={s.spinner} />
      <span>{t("status.running", { when: format.relativeTime(since, relativeNow(since, now)) })}</span>
    </p>
  );
}
