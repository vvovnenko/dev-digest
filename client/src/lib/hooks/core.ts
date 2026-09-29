/* hooks/core.ts — typed React Query hooks over the F1 API (contracts):
   settings, secrets, repos, pulls, and project context. Scaffolding screens use
   these; feature-domain hooks live in the sibling files (agents/reviews/trace/…)
   and are re-exported alongside these from hooks/index.ts. */
"use client";

import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { prKeys, repoKeys } from "./keys";
import type {
  Settings,
  SettingsUpdate,
  ConnTestProvider,
  ConnTestResult,
  SecretsStatus,
  Repo,
  PrMeta,
  PrDetail,
  SpecFile,
  IndexStatus,
} from "../types";

// ---- Settings (F1: GET/PUT /settings, POST /settings/test-connection) ----
export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<Settings>("/settings"),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsUpdate) => api.put<Settings>("/settings", patch),
    onSuccess: (data) => qc.setQueryData(["settings"], data),
  });
}

export function useTestConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConnTestProvider | { provider: ConnTestProvider; key?: string }) => {
      const body = typeof input === "string" ? { provider: input } : input;
      return api.post<ConnTestResult>("/settings/test-connection", body);
    },
    // Saving/validating a provider key can change which models resolve — drop the
    // cached (possibly empty) model lists so the agent picker refetches, and
    // refresh the "Configured / Not set" key-status badges.
    onSuccess: (res) => {
      if (res.ok) {
        void qc.invalidateQueries({ queryKey: ["provider-models"] });
        void qc.invalidateQueries({ queryKey: ["secrets-status"] });
      }
    },
  });
}

/** Which provider keys are configured (booleans only — never the values). */
export function useSecretsStatus() {
  return useQuery({
    queryKey: ["secrets-status"],
    queryFn: () => api.get<SecretsStatus>("/settings/secrets-status"),
    staleTime: 30_000,
  });
}

// ---- Repos (F1: GET/POST /repos, refresh, delete) ----
export function useRepos() {
  return useQuery({
    queryKey: ["repos"],
    queryFn: () => api.get<Repo[]>("/repos"),
  });
}

export function useAddRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (url: string) => api.post<Repo>("/repos", { url }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["repos"] }),
  });
}

export function useRefreshRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.post<Repo>(`/repos/${repoId}/refresh`),
    onSuccess: (_d, repoId) => {
      void qc.invalidateQueries({ queryKey: ["repos"] });
      void qc.invalidateQueries({ queryKey: repoKeys.pulls(repoId) });
    },
  });
}

export function useDeleteRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.del<{ deleted: string }>(`/repos/${repoId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["repos"] }),
  });
}

// ---- Pull requests (F1: GET /repos/:id/pulls, POST /repos/:id/poll, GET /pulls/:id) ----
/** How often a polling PR list re-reads the stored PRs. */
const PULLS_POLL_MS = 60_000;

/**
 * A repo's PRs as the server stores them. The GET only reads (importing from
 * GitHub is `useSyncPulls`), so screens that show PR statuses poll it
 * (`poll: true`); every observer still refetches on window focus.
 */
export function usePulls(repoId: string | null | undefined, { poll = false }: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: repoKeys.pulls(repoId ?? ""),
    queryFn: () => api.get<PrMeta[]>(`/repos/${repoId}/pulls`),
    enabled: !!repoId,
    refetchInterval: poll ? PULLS_POLL_MS : false,
    refetchOnWindowFocus: true,
  });
}

/**
 * Import a repo's PRs from GitHub (`POST /repos/:id/poll`), then re-read the list.
 * `silent` skips the global error toast: for automatic syncs, where a missing
 * GitHub token is expected rather than news.
 */
export function useSyncPulls({ silent = false }: { silent?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.post<{ synced: number }>(`/repos/${repoId}/poll`),
    meta: { silent },
    onSuccess: (_d, repoId) => {
      void qc.invalidateQueries({ queryKey: repoKeys.pulls(repoId) });
      void qc.invalidateQueries({ queryKey: ["repos"] });
    },
  });
}

/**
 * Silently import a repo's PRs once, the first time `enabled` holds for that
 * repo: the PR list when it opens, a PR page whose number isn't stored yet.
 * Only with a GitHub token configured — without one the poll can only fail —
 * and it runs as soon as a saved token turns the status on.
 */
export function useAutoSyncPulls(repoId: string | null | undefined, enabled = true) {
  const { data: secrets } = useSecretsStatus();
  const sync = useSyncPulls({ silent: true });
  const { mutate } = sync;
  const synced = React.useRef<string | null>(null);
  const hasToken = secrets?.github === true;
  React.useEffect(() => {
    if (!repoId || !enabled || !hasToken || synced.current === repoId) return;
    synced.current = repoId;
    mutate(repoId);
  }, [repoId, enabled, hasToken, mutate]);
  return sync;
}

export function usePullDetail(prId: string | null | undefined) {
  return useQuery({
    queryKey: prKeys.detail(prId ?? ""),
    queryFn: () => api.get<PrDetail>(`/pulls/${prId}`),
    enabled: !!prId,
  });
}

// ---- Project Context (A3 contract; safe to call once API exposes it) ----
export function useContextFiles(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["context", repoId],
    queryFn: () => api.get<SpecFile[]>(`/repos/${repoId}/context`),
    enabled: !!repoId,
  });
}

export function useReindexContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.post<IndexStatus>(`/repos/${repoId}/context/reindex`),
    onSuccess: (_d, repoId) => qc.invalidateQueries({ queryKey: ["context", repoId] }),
  });
}
