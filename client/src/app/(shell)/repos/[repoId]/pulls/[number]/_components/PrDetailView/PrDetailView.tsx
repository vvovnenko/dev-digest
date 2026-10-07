/* PR Detail — /repos/:repoId/pulls/:number. F2 shell extended by A2 with:
   - Findings panel (VerdictBanner + FindingCards)
   - RunReviewDropdown (run all / a specific agent) + live SSE RunStatus
   - Basic file-by-file diff viewer in the Files tab
   Tab and open trace live in the URL (?tab, ?trace). */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Skeleton, ErrorState } from "@devdigest/ui";
import { useShellCrumb } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ApiError } from "@/lib/api";
import { githubPrUrl } from "@/lib/github-urls";
import { allFindings, parseTab } from "../../helpers";
import { usePrDetail } from "../../usePrDetail";
import { PrDetailHeader } from "../PrDetailHeader";
import { OverviewTab } from "../OverviewTab";
import { FindingsTab } from "../FindingsTab";
import { DiffTab } from "../DiffTab";
import { RunTraceDrawer } from "../RunTraceDrawer";
import { s } from "./styles";

export function PrDetailView() {
  const t = useTranslations("prReview");
  const { repoId, number } = useParams<{ repoId: string; number: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const { prId, pr, isLoading, isError, error, refetch, reviews, runs, liveRunIds } = usePrDetail(repoId, number);

  const tab = parseTab(search.get("tab"));
  const traceRunId = search.get("trace");
  const setParam = (key: "tab" | "trace", val: string | null) => {
    const sp = new URLSearchParams(search.toString());
    if (val == null) sp.delete(key);
    else sp.set(key, val);
    router.replace(`/repos/${repoId}/pulls/${number}${sp.toString() ? `?${sp.toString()}` : ""}`);
  };

  const findings = React.useMemo(() => allFindings(reviews), [reviews]);
  const lethalTrifecta = findings.filter((f) => f.kind === "lethal_trifecta");
  // The real "owner/repo" (null until the repo is loaded) — for github.com deep-links.
  const repoFullName = activeRepo?.full_name ?? null;
  useShellCrumb([
    { label: activeRepo?.full_name ?? repoId, mono: true, href: `/repos/${repoId}/pulls` },
    { label: t("list.breadcrumb"), href: `/repos/${repoId}/pulls` },
    { label: `#${number}`, mono: true },
  ]);

  // Stale/unknown :repoId → friendly empty state instead of a 404 error.
  if (repoNotFound) return <RepoNotFound />;

  if (isLoading) {
    return (
      <div style={s.loading}>
        <Skeleton height={28} width={420} />
        <Skeleton height={16} width={300} />
        <Skeleton height={200} />
      </div>
    );
  }

  if (isError || !pr || !prId) {
    return (
      <ErrorState
        fullScreen
        title={t("detail.loadErrorTitle")}
        body={error instanceof ApiError ? error.message : t("detail.loadErrorBody", { number })}
        onRetry={() => void refetch()}
      />
    );
  }

  const traceReview = traceRunId ? reviews.find((r) => r.run_id === traceRunId) : undefined;
  return (
    <>
      <PrDetailHeader
        pr={pr}
        prId={prId}
        tab={tab}
        findingsCount={findings.length}
        githubUrl={repoFullName ? githubPrUrl(repoFullName, pr.number) : null}
        onSetTab={(next) => setParam("tab", next)}
        onRunStart={() => setParam("tab", "findings")}
      />

      <div style={s.body}>
        {tab === "overview" && <OverviewTab prBody={pr.body} />}

        {tab === "findings" && (
          <FindingsTab
            prId={prId}
            liveRunIds={liveRunIds}
            lethalTrifecta={lethalTrifecta}
            reviews={reviews}
            prRuns={runs}
            prCommits={pr.commits}
            repoFullName={repoFullName}
            headSha={pr.head_sha}
            onOpenTrace={(id) => setParam("trace", id)}
          />
        )}

        {tab === "diff" && (
          <DiffTab prId={prId} filesCount={pr.files_count} files={pr.files} canComment={pr.status === "open"} />
        )}
      </div>

      {traceRunId && (
        <RunTraceDrawer
          key={traceRunId}
          runId={traceRunId}
          running={liveRunIds.includes(traceRunId)}
          prNumber={pr.number}
          findings={traceReview?.findings ?? []}
          agentName={traceReview?.agent_name ?? null}
          onClose={() => setParam("trace", null)}
        />
      )}
    </>
  );
}
