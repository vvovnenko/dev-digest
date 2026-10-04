/* hooks/skills.ts — React Query hooks for the Skills Lab (list, editor, versions, import). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { skillKeys } from "./keys";
import type {
  Skill,
  SkillAgentUse,
  SkillCreate,
  SkillImportPreview,
  SkillImportRequest,
  SkillUpdate,
  SkillVersion,
} from "@devdigest/shared";

export function useSkills() {
  return useQuery({
    queryKey: skillKeys.list,
    queryFn: () => api.get<Skill[]>("/skills"),
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: skillKeys.detail(id ?? ""),
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

/** Snapshot history, newest first. */
export function useSkillVersions(id: string | null | undefined) {
  return useQuery({
    queryKey: skillKeys.versions(id ?? ""),
    queryFn: () => api.get<SkillVersion[]>(`/skills/${id}/versions`),
    enabled: !!id,
  });
}

/** Agents that have the skill linked and enabled (Stats tab). */
export function useSkillAgents(id: string | null | undefined) {
  return useQuery({
    queryKey: skillKeys.agents(id ?? ""),
    queryFn: () => api.get<SkillAgentUse[]>(`/skills/${id}/agents`),
    enabled: !!id,
  });
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SkillCreate) => api.post<Skill>("/skills", input),
    onSuccess: (data) => {
      qc.setQueryData(skillKeys.detail(data.id), data);
      void qc.invalidateQueries({ queryKey: skillKeys.all });
    },
  });
}

export interface UpdateSkillInput {
  id: string;
  /** Body of PUT /skills/:id — only the fields that changed. */
  patch: SkillUpdate;
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.setQueryData(skillKeys.detail(data.id), data);
      void qc.invalidateQueries({ queryKey: skillKeys.all });
    },
  });
}

/** Deleting a skill also unlinks it from every agent, so agent data refreshes too. */
export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: skillKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: skillKeys.all });
      void qc.invalidateQueries({ queryKey: ["agents"] });
      void qc.invalidateQueries({ queryKey: ["agent"] });
    },
  });
}

export interface RestoreSkillVersionInput {
  id: string;
  version: number;
}

/** Restore = a NEW version carrying vN's content ("Restored vN"). */
export function useRestoreSkillVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: RestoreSkillVersionInput) =>
      api.post<Skill>(`/skills/${id}/versions/${version}/restore`),
    onSuccess: (data) => {
      qc.setQueryData(skillKeys.detail(data.id), data);
      void qc.invalidateQueries({ queryKey: skillKeys.all });
    },
  });
}

/** Parse an uploaded .md / .zip into a draft. Writes nothing — saving is `useCreateSkill`. */
export function usePreviewSkillImport() {
  return useMutation({
    mutationFn: (input: SkillImportRequest) =>
      api.post<SkillImportPreview>("/skills/import/preview", input),
  });
}
