/* PrDetailHeader — PR title/author/branch/diff stats + status, the GitHub link,
   Run Review, and the Overview / Agent runs / Files changed tabs. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Avatar, Badge, Button, Tabs } from "@devdigest/ui";
import type { PrDetail } from "@/lib/types";
import { STATUS_META } from "../../../constants";
import { RunReviewDropdown } from "../RunReviewDropdown";
import { s } from "./styles";

interface PrDetailHeaderProps {
  pr: PrDetail;
  prId: string;
  tab: string;
  findingsCount: number;
  /** github.com PR URL; null when the repo's full_name isn't known yet. */
  githubUrl?: string | null;
  onSetTab: (tab: string) => void;
  /** A review was started from Run Review (the page switches to Agent runs). */
  onRunStart: () => void;
}

export function PrDetailHeader({ pr, prId, tab, findingsCount, githubUrl, onSetTab, onRunStart }: PrDetailHeaderProps) {
  const t = useTranslations("prReview");
  // Unknown statuses (a newer server) render as "open".
  const status = STATUS_META[pr.status] ?? STATUS_META.open;
  const closed = pr.status === "merged" || pr.status === "closed";

  return (
    <div style={s.root}>
      <div style={s.titleRow}>
        <div style={s.titleCol}>
          <h1 style={s.h1}>
            <span className="mono" style={s.prNumber}>
              #{pr.number}
            </span>
            {pr.title}
          </h1>
          <div style={s.meta}>
            <span style={s.authorChip}>
              <Avatar name={pr.author} size={17} />
              {pr.author}
            </span>
            <span style={s.branchChip}>
              <Icon.GitBranch size={13} style={s.mutedIcon} />
              <span className="mono" style={s.branchMono}>
                {pr.branch}
              </span>
              <Icon.ArrowRight size={11} />
              <span className="mono" style={s.branchMono}>
                {pr.base}
              </span>
            </span>
            <span className="mono tnum">
              <span style={s.additions}>+{pr.additions}</span> <span style={s.deletions}>−{pr.deletions}</span>
            </span>
            <Badge dot bg="transparent" color={status.c}>
              {t(`list.status.${status.labelKey}`)}
            </Badge>
          </div>
        </div>
        <div style={s.actions}>
          <Button
            kind="ghost"
            size="sm"
            icon="ExternalLink"
            disabled={!githubUrl}
            onClick={() => githubUrl && window.open(githubUrl, "_blank", "noopener,noreferrer")}
          >
            {t("header.viewOnGitHub")}
          </Button>
          <RunReviewDropdown prId={prId} warnMerged={closed} onRunStart={onRunStart} />
        </div>
      </div>
      {closed && (
        <div style={s.staleBanner}>
          <Icon.AlertTriangle size={13} style={s.warnIcon} />
          <span>{t("header.alreadyClosed", { status: pr.status })}</span>
        </div>
      )}
      <Tabs
        value={tab}
        onChange={onSetTab}
        pad="0"
        tabs={[
          { key: "overview", label: t("header.tabs.overview"), icon: "FileText" },
          {
            key: "findings",
            label: t("header.tabs.findings"),
            icon: "AlertOctagon",
            count: findingsCount || undefined,
          },
          { key: "diff", label: t("header.tabs.diff"), icon: "Code", count: pr.files_count },
        ]}
      />
    </div>
  );
}
