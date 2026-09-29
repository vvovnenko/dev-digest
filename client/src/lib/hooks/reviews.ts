/* hooks/reviews.ts — React Query + SSE hooks for the A2 reviewer.
   Run a review, stream RunEvents live, act on findings. */
"use client";

import React from "react";
import { useQuery, useMutation, useMutationState, useQueryClient } from "@tanstack/react-query";
import { api, API_BASE } from "../api";
import { notify } from "../toast";
import { prKeys, repoKeys, runKeys } from "./keys";
import type {
  FindingActionKind,
  FindingRecord,
  PrReviewComment,
  ReviewRecord,
  ReviewRunResponse,
  RunEvent,
  RunSummary,
} from "@devdigest/shared";

/** How often the run history refetches while a run is in flight. */
const RUN_POLL_MS = 4000;

// ---- Full run history for a PR (every agent_runs row, any status) ----
/** All runs for a PR — done, failed (with error), cancelled, running. Survives
   reload (DB-backed). Polls while anything is running so it self-updates; the
   in-flight runs are the ones with `status: "running"`. */
export function usePrRuns(prId: string | null | undefined) {
  return useQuery({
    queryKey: prKeys.runs(prId ?? ""),
    queryFn: () => api.get<RunSummary[]>(`/pulls/${prId}/runs`),
    enabled: !!prId,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((r) => r.status === "running") ? RUN_POLL_MS : false,
  });
}

// ---- Persisted reviews + findings for a PR ----
export function usePrReviews(prId: string | null | undefined) {
  return useQuery({
    queryKey: prKeys.reviews(prId ?? ""),
    queryFn: () => api.get<ReviewRecord[]>(`/pulls/${prId}/reviews`),
    enabled: !!prId,
  });
}

/**
 * Refresh everything a finished run changed: the run history, the reviews, any
 * open trace (it is written when the run ends) and the PR lists (the PR's
 * status and score). Call it when a run's stream ends.
 */
export function useRunSettled(prId: string | null | undefined) {
  const qc = useQueryClient();
  return React.useCallback(() => {
    if (prId) void qc.invalidateQueries({ queryKey: prKeys.all(prId) });
    void qc.invalidateQueries({ queryKey: runKeys.all });
    void qc.invalidateQueries({ queryKey: repoKeys.allPulls });
  }, [qc, prId]);
}

/** Delete one run from the PR's run history (+ its trace). */
export function useDeleteRun(prId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => api.del<{ ok: boolean }>(`/runs/${runId}`),
    // Deleting a run also deletes the review it produced (server-side), so drop
    // both the timeline and the Review Runs list from cache.
    onSuccess: () => qc.invalidateQueries({ queryKey: prKeys.all(prId) }),
  });
}

/** Cancel an in-flight run; the run history then shows it cancelled. */
export function useCancelRun(prId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => api.post<{ ok: boolean }>(`/runs/${runId}/cancel`),
    onSettled: () => qc.invalidateQueries({ queryKey: prKeys.runs(prId) }),
  });
}

/** Delete a whole review run (one agent's pass) + its findings. */
export function useDeleteReview(prId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reviewId: string) => api.del<{ ok: boolean }>(`/reviews/${reviewId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: prKeys.reviews(prId) }),
  });
}

// ---- Inline review comments on the "Files changed" tab (proxied to GitHub) --
/** Existing GitHub PR review comments, fetched live. */
export function usePrComments(prId: string | null | undefined) {
  return useQuery({
    queryKey: prKeys.comments(prId ?? ""),
    queryFn: () => api.get<PrReviewComment[]>(`/pulls/${prId}/comments`),
    enabled: !!prId,
  });
}

export interface CreateCommentInput {
  path: string;
  line: number;
  side?: "LEFT" | "RIGHT";
  body: string;
  in_reply_to?: number;
}

/** Post one inline comment (or reply) to GitHub; refreshes the thread list. */
export function useCreatePrComment(prId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCommentInput) =>
      api.post<PrReviewComment>(`/pulls/${prId}/comments`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: prKeys.comments(prId) }),
  });
}

// ---- Run a review (all enabled agents or a specific agent) ----
export interface RunReviewInput {
  prId: string;
  agentId?: string;
  all?: boolean;
}

/** Start a review; the new runs show up in the run history (which then polls) at once. */
export function useRunReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, agentId, all }: RunReviewInput) =>
      api.post<ReviewRunResponse>(`/pulls/${prId}/review`, {
        ...(agentId ? { agentId } : {}),
        ...(all ? { all } : {}),
      }),
    onSuccess: (_d, { prId }) => qc.invalidateQueries({ queryKey: prKeys.all(prId) }),
  });
}

// ---- Finding actions (accept/dismiss) ----
export interface FindingActionInput {
  findingId: string;
  action: FindingActionKind;
  reply?: string;
}

const findingActionKey = (prId: string) => ["finding-action", prId] as const;

/** A finding as the server leaves it after `action` (accept and dismiss exclude each other). */
function applyAction(f: FindingRecord, action: FindingActionKind, at: string): FindingRecord {
  if (action === "accept") return { ...f, accepted_at: at, dismissed_at: null };
  if (action === "dismiss") return { ...f, dismissed_at: at, accepted_at: null };
  return f;
}

/**
 * Accept / dismiss a finding. The card changes at once (optimistic update of the
 * PR's reviews) and rolls back if the server refuses; the refetch afterwards
 * brings the server's timestamps.
 */
export function useFindingAction(prId: string) {
  const qc = useQueryClient();
  const key = prKeys.reviews(prId);
  return useMutation({
    mutationKey: findingActionKey(prId),
    mutationFn: ({ findingId, action, reply }: FindingActionInput) =>
      api.post<{ finding: FindingRecord; memoryId?: string }>(
        `/findings/${findingId}/${action}`,
        reply ? { reply } : undefined,
      ),
    onMutate: async ({ findingId, action }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ReviewRecord[]>(key);
      const at = new Date().toISOString();
      qc.setQueryData<ReviewRecord[]>(key, (reviews) =>
        reviews?.map((r) => ({
          ...r,
          findings: r.findings.map((f) => (f.id === findingId ? applyAction(f, action, at) : f)),
        })),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

/** Ids of the findings with an accept/dismiss in flight — each card shows its own pending state. */
export function usePendingFindingIds(prId: string): ReadonlySet<string> {
  const ids = useMutationState({
    filters: { mutationKey: findingActionKey(prId), status: "pending" },
    select: (m) => (m.state.variables as FindingActionInput | undefined)?.findingId,
  });
  return React.useMemo(() => new Set(ids.filter((id): id is string => !!id)), [ids]);
}

/** The event that ends a run's stream (the server's `SSE_DONE_EVENT`). */
const DONE_EVENT = "done";
const EVENT_KINDS = ["info", "tool", "result", "error"] as const;

/**
 * Subscribe to runs' SSE streams (in parallel). Returns their events and
 * `running`, true until every stream has sent its terminal `done` (or the
 * server refused it). A dropped connection is left to EventSource's own
 * reconnect; the server then replays the run from the start, so events are
 * de-duplicated by run + `seq` — and an `error` event toasts only once.
 */
export function useRunEvents(runIds: string[]) {
  const [events, setEvents] = React.useState<RunEvent[]>([]);
  // Running from the first render when there is something to stream — not only
  // after the effect subscribes, or a consumer briefly treats a live run as done.
  const [running, setRunning] = React.useState(runIds.length > 0);
  const key = runIds.join(",");

  React.useEffect(() => {
    if (runIds.length === 0) return;
    setEvents([]);
    setRunning(true);
    const seen = new Set<string>();
    const finished = new Set<string>();
    const sources: EventSource[] = [];
    const finish = (runId: string, es: EventSource) => {
      es.close();
      finished.add(runId);
      if (finished.size === runIds.length) setRunning(false);
    };

    for (const runId of runIds) {
      const es = new EventSource(`${API_BASE}/runs/${runId}/events`);
      const onEvent = (ev: MessageEvent) => {
        let parsed: RunEvent;
        try {
          parsed = JSON.parse(ev.data) as RunEvent;
        } catch {
          return; // not a run event
        }
        const id = `${parsed.runId}:${parsed.seq}`;
        if (seen.has(id)) return;
        seen.add(id);
        setEvents((prev) => [...prev, parsed]);
        // Runtime agent failures arrive as SSE `error` events (not as a
        // mutation/query error), so the global error toast never sees them —
        // surface them here so the user gets a notification without a reload.
        if (parsed.kind === "error" && parsed.msg) notify.error(parsed.msg);
      };
      // The server names each event by its kind.
      for (const kind of EVENT_KINDS) es.addEventListener(kind, onEvent as EventListener);
      es.addEventListener(DONE_EVENT, () => finish(runId, es));
      // CONNECTING = EventSource is already reconnecting after a drop; CLOSED =
      // the server refused the stream (e.g. an unknown run) — nothing will come.
      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) finish(runId, es);
      };
      sources.push(es);
    }

    return () => {
      for (const es of sources) es.close();
      setRunning(false);
    };
    // Deps are the ids' value (`key`), not the array: a fresh array must not resubscribe.
  }, [key]);

  return { events, running };
}
