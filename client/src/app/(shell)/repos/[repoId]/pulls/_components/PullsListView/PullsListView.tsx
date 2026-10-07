/* PR list — /repos/:repoId/pulls. Ported from screen_dashboard.jsx; fetches
   GET /repos/:id/pulls (F1). The status chip, search and sort live in the URL
   (?status, ?q, ?sort), so a reload or Back keeps them. */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Skeleton, EmptyState, ErrorState, AutoTriggerStatus } from "@devdigest/ui";
import { useShellCrumb } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useAutoSyncPulls, usePulls, useRefreshRepo, useSyncPulls } from "@/lib/hooks";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { ApiError } from "@/lib/api";
import { COLUMN_KEYS, DEFAULT_SORT, DEFAULT_STATUS, SEARCH_URL_DELAY_MS, SKELETON_ROWS } from "../../constants";
import { countPulls, filterPulls, parseSort, sortPulls } from "../../helpers";
import { s } from "../../styles";
import { PRRow } from "../PRRow";
import { FilterBar } from "../FilterBar";

export function PullsListView() {
  const t = useTranslations("prReview");
  const { repoId } = useParams<{ repoId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const { data: pulls, isLoading, isError, error, refetch } = usePulls(repoId, { poll: true });
  const refresh = useRefreshRepo();
  // The list GET only reads: import from GitHub when the list opens (silently —
  // no token is a normal local setup) and on Refresh (a failure is toasted).
  useAutoSyncPulls(repoId);
  const sync = useSyncPulls();

  const status = search.get("status") ?? DEFAULT_STATUS;
  const query = search.get("q") ?? "";
  const sort = parseSort(search.get("sort"));
  /** Update one URL param; `null` (or the default) drops it. `status` is always explicit so "all" sticks. */
  const setParam = (key: "status" | "q" | "sort", value: string | null) => {
    const sp = new URLSearchParams(search.toString());
    if (value == null || value === "" || (key === "sort" && value === DEFAULT_SORT)) sp.delete(key);
    else sp.set(key, value);
    const qs = sp.toString();
    router.replace(`/repos/${repoId}/pulls${qs ? `?${qs}` : ""}`, { scroll: false });
  };

  // The search box filters as you type; the URL follows after a pause, so a
  // navigation per keystroke can't lag the input. Back/Forward re-sync it.
  const [draft, setDraft] = React.useState(query);
  React.useEffect(() => setDraft(query), [query]);
  const urlTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(urlTimer.current), []);
  const onQuery = (q: string) => {
    setDraft(q);
    clearTimeout(urlTimer.current);
    urlTimer.current = setTimeout(() => setParam("q", q), SEARCH_URL_DELAY_MS);
  };

  const visible = sortPulls(filterPulls(pulls ?? [], status, draft), sort);
  const counts = countPulls(pulls ?? []);
  const repoName = activeRepo?.full_name ?? repoId;
  useShellCrumb([{ label: repoName, mono: true }, { label: t("list.breadcrumb") }]);

  // Stale/unknown :repoId → friendly empty state instead of a 404 error.
  if (repoNotFound) return <RepoNotFound />;

  return (
    <>
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>{t("list.title")}</h1>
          <p style={s.pageSubtitle}>
            {pulls
              ? t("list.summary", { open: counts.open, needsReview: counts.needsReview })
              : t("list.loading")}
          </p>
        </div>
        <div style={s.headerActions}>
          <AutoTriggerStatus on={false} />
        </div>
      </div>

      <div style={s.tableCard}>
        <FilterBar
          active={status}
          onActive={(k) => setParam("status", k)}
          query={draft}
          onQuery={onQuery}
          sort={sort}
          onSort={(k) => setParam("sort", k)}
          onRefresh={() => {
            refresh.mutate(repoId);
            sync.mutate(repoId);
          }}
          refreshing={refresh.isPending || sync.isPending}
        />
        <div style={s.headRow}>
          {COLUMN_KEYS.map((key, i) => (
            <div key={key} style={s.headCell(i === COLUMN_KEYS.length - 1)}>
              {t(`list.columns.${key}`)}
            </div>
          ))}
        </div>

        {isLoading ? (
          <div style={s.loadingStack}>
            {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <Skeleton key={i} height={28} />
            ))}
          </div>
        ) : isError ? (
          <ErrorState
            title={t("list.errorTitle")}
            body={error instanceof ApiError ? error.message : t("list.errorBody")}
            onRetry={() => void refetch()}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon="GitPullRequest"
            title={t("list.emptyTitle")}
            body={status === "all" ? t("list.emptyAllBody") : t("list.emptyStatusBody", { status })}
          />
        ) : (
          visible.map((pr) => (
            <PRRow key={pr.number} pr={pr} repoId={repoId} repoFullName={activeRepo?.full_name ?? null} />
          ))
        )}
      </div>
    </>
  );
}
