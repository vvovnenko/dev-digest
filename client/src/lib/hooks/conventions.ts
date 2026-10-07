/* hooks/conventions.ts — React Query hooks for Skills Lab → Conventions: the
   repo's scans and candidates (polled while a scan runs), starting a scan,
   accept / reject / edit, and the one skill made from the accepted candidates. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { isScanActive } from "../conventions";
import { conventionKeys, skillKeys } from "./keys";
import type {
  ConventionCandidate,
  ConventionSkillCreate,
  ConventionSkillDraft,
  ConventionsState,
  ConventionUpdate,
  Skill,
} from "@devdigest/shared";

/** How often the conventions state is refetched while a scan is queued or running. */
const CONVENTIONS_POLL_MS = 2000;

/**
 * The latest done scan (null before the first one), the newest scan of any
 * status, and every non-rejected candidate, confidence first. Polls while that
 * newest scan is queued or running — also one started in another tab or before
 * a reload — and stops once it is done or failed; the done scan's candidates
 * arrive in the same reply, so nothing else needs refetching.
 */
export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: conventionKeys.state(repoId ?? ""),
    queryFn: () => api.get<ConventionsState>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
    refetchInterval: (query) => (isScanActive(query.state.data?.latest_scan) ? CONVENTIONS_POLL_MS : false),
  });
}

/**
 * Create a scan; its result arrives by polling. The server answers at once
 * (202) with the state — `latest_scan` queued, or the scan already in flight —
 * and writing that into the cache starts `useConventions`' polling.
 */
export function useExtractConventions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.post<ConventionsState>(`/repos/${repoId}/conventions/extract`),
    onSuccess: (data, repoId) => qc.setQueryData(conventionKeys.state(repoId), data),
  });
}

export interface UpdateConventionInput {
  repoId: string;
  id: string;
  /** Body of PUT /conventions/:id — a status change or an edited rule. */
  patch: ConventionUpdate;
}

/** A candidate as the server leaves it after `patch`; `accepted` mirrors the status. */
function applyUpdate(c: ConventionCandidate, patch: ConventionUpdate): ConventionCandidate {
  const next = patch.rule !== undefined ? { ...c, rule: patch.rule } : c;
  return patch.status ? { ...next, status: patch.status, accepted: patch.status === "accepted" } : next;
}

/** `candidate` written over its old copy; a rejected one leaves the list (it is never listed). */
function replaceCandidate(state: ConventionsState, candidate: ConventionCandidate): ConventionsState {
  return {
    ...state,
    candidates:
      candidate.status === "rejected"
        ? state.candidates.filter((c) => c.id !== candidate.id)
        : state.candidates.map((c) => (c.id === candidate.id ? candidate : c)),
  };
}

/**
 * Accept, reject, set back to pending, or edit a candidate's rule. The card
 * changes at once (a rejected one disappears) and rolls back if the server
 * refuses. The list is refetched only once the last of several quick edits
 * settles, so an earlier refetch can't bring back a card another edit changed.
 */
export function useUpdateConvention() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: conventionKeys.update,
    mutationFn: ({ id, patch }: UpdateConventionInput) =>
      api.put<ConventionCandidate>(`/conventions/${id}`, patch),
    onMutate: async ({ repoId, id, patch }) => {
      const key = conventionKeys.state(repoId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ConventionsState>(key);
      const current = previous?.candidates.find((c) => c.id === id);
      if (previous && current) qc.setQueryData(key, replaceCandidate(previous, applyUpdate(current, patch)));
      return { previous };
    },
    onError: (_err, { repoId }, ctx) => {
      if (ctx?.previous) qc.setQueryData(conventionKeys.state(repoId), ctx.previous);
    },
    onSuccess: (data, { repoId }) =>
      qc.setQueryData<ConventionsState>(conventionKeys.state(repoId), (state) =>
        state ? replaceCandidate(state, data) : state,
      ),
    onSettled: (_data, _err, { repoId }) => {
      // This mutation still counts as running here, so 1 means "no other edit in flight".
      if (qc.isMutating({ mutationKey: conventionKeys.update }) === 1) {
        void qc.invalidateQueries({ queryKey: conventionKeys.state(repoId) });
      }
    },
  });
}

/** Set every accepted candidate back to pending. Optimistic, rolled back on error. */
export function useDeselectAllConventions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.post<{ updated: number }>(`/repos/${repoId}/conventions/deselect-all`),
    onMutate: async (repoId) => {
      const key = conventionKeys.state(repoId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ConventionsState>(key);
      if (previous) {
        qc.setQueryData<ConventionsState>(key, {
          ...previous,
          candidates: previous.candidates.map((c) =>
            c.status === "accepted" ? applyUpdate(c, { status: "pending" }) : c,
          ),
        });
      }
      return { previous };
    },
    onError: (_err, repoId, ctx) => {
      if (ctx?.previous) qc.setQueryData(conventionKeys.state(repoId), ctx.previous);
    },
    onSettled: (_data, _err, repoId) => qc.invalidateQueries({ queryKey: conventionKeys.state(repoId) }),
  });
}

/**
 * The accepted candidates merged into one editable skill (422 while none is
 * accepted). Fetched fresh every time the modal opens: nothing is kept once it
 * closes (`gcTime: 0`), so the form never starts from an older set of rules.
 */
export function useConventionSkillDraft(repoId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: conventionKeys.skillDraft(repoId ?? ""),
    queryFn: () => api.get<ConventionSkillDraft>(`/repos/${repoId}/conventions/skill-draft`),
    enabled: !!repoId && enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

export interface CreateConventionSkillInput {
  repoId: string;
  skill: ConventionSkillCreate;
}

/** Save the (edited) draft as a new skill; the Skills Lab lists it right away. */
export function useCreateConventionSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, skill }: CreateConventionSkillInput) =>
      api.post<Skill>(`/repos/${repoId}/conventions/skill`, skill),
    onSuccess: (data) => {
      qc.setQueryData(skillKeys.detail(data.id), data);
      void qc.invalidateQueries({ queryKey: skillKeys.all });
    },
  });
}
