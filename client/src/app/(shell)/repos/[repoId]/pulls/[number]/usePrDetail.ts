"use client";

import { useAutoSyncPulls, usePullDetail, usePulls } from "@/lib/hooks";
import { usePrReviews, usePrRuns } from "@/lib/hooks/reviews";
import { liveRunIds } from "./helpers";

/**
 * Everything the PR detail page shows, by route params. The route is keyed by
 * PR number, but every PR API is keyed by the row's uuid — resolved through the
 * repo's (cached) PR list before anything PR-scoped is fetched.
 */
export function usePrDetail(repoId: string, number: string) {
  const pulls = usePulls(repoId);
  const prId = pulls.data?.find((p) => p.number === Number(number))?.id ?? null;
  // A deep link to a PR that isn't imported yet: import the repo's PRs once, then look again.
  const sync = useAutoSyncPulls(repoId, pulls.isSuccess && prId == null);
  const detail = usePullDetail(prId);
  const reviews = usePrReviews(prId);
  const runs = usePrRuns(prId);
  return {
    prId,
    pr: detail.data,
    isLoading: pulls.isLoading || (prId == null && sync.isPending) || (prId != null && detail.isLoading),
    isError: detail.isError,
    error: detail.error,
    refetch: detail.refetch,
    /** Reviews, newest first; each is one agent's run. */
    reviews: reviews.data ?? [],
    runs: runs.data,
    liveRunIds: liveRunIds(runs.data),
  };
}
