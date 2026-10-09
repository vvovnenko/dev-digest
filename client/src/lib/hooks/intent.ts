/* hooks/intent.ts — React Query hooks for a PR's intent: the last derived
   result and the latest attempt (polled while one runs), and starting a derive. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { isIntentActive } from "../intent";
import { prKeys } from "./keys";
import type { PrIntentState } from "@devdigest/shared";

/** How often the intent state is refetched while a derive is queued or running. */
const INTENT_POLL_MS = 2000;

/**
 * The PR's intent state. Polls while the latest attempt is queued or running —
 * also one started in another tab or before a reload — and stops once it is
 * done or failed.
 */
export function usePrIntent(prId: string | null | undefined) {
  return useQuery({
    queryKey: prKeys.intent(prId ?? ""),
    queryFn: () => api.get<PrIntentState>(`/pulls/${prId}/intent`),
    enabled: !!prId,
    refetchInterval: (query) => (isIntentActive(query.state.data?.status) ? INTENT_POLL_MS : false),
  });
}

/**
 * Start a derive; its result arrives by polling. The server answers at once
 * (202) with the state — queued, or the attempt already in flight — and
 * writing that into the cache starts `usePrIntent`'s polling.
 */
export function useDeriveIntent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prId: string) => api.post<PrIntentState>(`/pulls/${prId}/intent`),
    onSuccess: (data, prId) => qc.setQueryData(prKeys.intent(prId), data),
  });
}
