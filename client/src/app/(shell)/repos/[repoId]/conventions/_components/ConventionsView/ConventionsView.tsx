/* /repos/:repoId/conventions — Skills Lab → Conventions. "Run scan" (first
   time, in the empty state) or "Re-scan" (header) starts a background scan that
   asks the model for the repo's house rules; each grounded candidate can be
   accepted, rejected or edited, and "Create skill" (shown once one is accepted)
   merges the accepted ones into one skill. "Scanning…" follows the newest scan
   (polled while queued or running), so it survives a reload or a second tab;
   ScanStatus says how it is going, or why it failed. A refused start (repo not
   cloned / indexed) is toasted by the global mutation handler. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { useShellCrumb } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { isScanActive } from "@/lib/conventions";
import { useConventions, useDeselectAllConventions, useExtractConventions } from "@/lib/hooks/conventions";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { acceptedCount, relativeNow } from "../../helpers";
import { CandidateCard } from "../CandidateCard";
import { CreateConventionSkillModal } from "../CreateConventionSkillModal";
import { ScanStatus } from "./_components/ScanStatus";
import { NOW_TICK_MS, SKELETON_CARDS } from "./constants";
import { s } from "./styles";

export function ConventionsView() {
  const t = useTranslations("conventions");
  const format = useFormatter();
  const now = useNow({ updateInterval: NOW_TICK_MS });
  const { repoId } = useParams<{ repoId: string }>();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const { data, isLoading, isError, refetch } = useConventions(repoId);
  const extract = useExtractConventions();
  const deselectAll = useDeselectAllConventions();
  const [creatingSkill, setCreatingSkill] = React.useState(false);
  useShellCrumb([{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }]);

  // Stale/unknown :repoId → friendly empty state instead of a 404 error.
  if (repoNotFound) return <RepoNotFound />;

  const scan = data?.scan ?? null;
  const latestScan = data?.latest_scan ?? null;
  const candidates = data?.candidates ?? [];
  const accepted = acceptedCount(candidates);
  const scanning = isScanActive(latestScan) || extract.isPending;
  const repoName = activeRepo?.name ?? t("page.repoFallback");
  const runScan = () => extract.mutate(repoId);
  const sinceScan = (iso: string) => {
    const at = new Date(iso);
    return format.relativeTime(at, relativeNow(at, now));
  };

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={s.headerText}>
          <h1 style={s.h1}>
            {t("page.headingPrefix")}
            <span className="mono" style={s.repoName}>
              {repoName}
            </span>
          </h1>
          {scan && (
            <p style={s.subtitle}>
              {t("page.subtitle", { count: scan.sample_files.length, when: sinceScan(scan.created_at) })}
            </p>
          )}
          <ScanStatus scan={scan} latest={latestScan} />
        </div>
        {scan && (
          <Button kind="secondary" icon="RefreshCw" loading={scanning} onClick={runScan}>
            {scanning ? t("page.scanning") : t("page.rescan")}
          </Button>
        )}
      </div>

      {isLoading && (
        <div style={s.list}>
          {Array.from({ length: SKELETON_CARDS }, (_, i) => (
            <Skeleton key={i} height={180} />
          ))}
        </div>
      )}
      {isError && <ErrorState body={t("page.loadError")} onRetry={() => void refetch()} />}
      {data && !scan && (
        <EmptyState
          icon="ListChecks"
          title={t("page.empty.title")}
          body={t("page.empty.body")}
          cta={scanning ? t("page.scanning") : t("page.empty.cta")}
          onCta={runScan}
          ctaLoading={scanning}
        />
      )}
      {scan && candidates.length === 0 && <p style={s.noCandidates}>{t("page.noCandidates")}</p>}
      {candidates.length > 0 && (
        <>
          <div style={s.toolbar}>
            <Button
              kind="secondary"
              icon="X"
              disabled={accepted === 0 || scanning || deselectAll.isPending}
              onClick={() => deselectAll.mutate(repoId)}
            >
              {t("page.deselectAll")}
            </Button>
            <span className="tnum" style={s.count}>
              {t("page.acceptedCount", { accepted, total: candidates.length })}
            </span>
            {accepted > 0 && (
              <Button kind="primary" icon="Sparkles" style={s.createBtn} onClick={() => setCreatingSkill(true)}>
                {t("page.createSkill")}
              </Button>
            )}
          </div>
          <div style={s.list}>
            {candidates.map((c) => (
              <CandidateCard key={c.id} candidate={c} repoId={repoId} disabled={scanning} />
            ))}
          </div>
        </>
      )}

      {creatingSkill && (
        <CreateConventionSkillModal repoId={repoId} repoName={repoName} onClose={() => setCreatingSkill(false)} />
      )}
    </div>
  );
}
