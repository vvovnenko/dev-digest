/* hooks/agents.ts — React Query hooks for the A2 Agents tab + Agent Editor. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { agentSkillKeys, skillKeys } from "./keys";
import type {
  Agent,
  AgentCreate,
  AgentSkillLink,
  AgentSkillLinkInput,
  AgentSkillsUpdate,
  AgentUpdate,
  ModelInfo,
  Provider,
  ReviewStrategy,
} from "@devdigest/shared";

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => api.get<Agent[]>("/agents"),
  });
}

export function useAgent(id: string | null | undefined) {
  return useQuery({
    queryKey: ["agent", id],
    queryFn: () => api.get<Agent>(`/agents/${id}`),
    enabled: !!id,
  });
}

/** Body of POST /agents (the shared contract). */
export type CreateAgentInput = AgentCreate;

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentInput) => api.post<Agent>("/agents", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });
}

export interface UpdateAgentInput {
  id: string;
  /** Body of PUT /agents/:id (the shared contract). */
  patch: AgentUpdate;
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateAgentInput) => api.put<Agent>(`/agents/${id}`, patch),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["agents"] });
      qc.setQueryData(["agent", data.id], data);
    },
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/agents/${id}`),
    onSuccess: (_d, id) => {
      void qc.invalidateQueries({ queryKey: ["agents"] });
      qc.removeQueries({ queryKey: ["agent", id] });
    },
  });
}

/** Dynamic model list for a provider (editor model picker). */
export function useProviderModels(provider: Provider | null | undefined) {
  return useQuery({
    queryKey: ["provider-models", provider],
    queryFn: () => api.get<ModelInfo[]>(`/providers/${provider}/models`),
    enabled: !!provider,
    staleTime: 5 * 60_000,
  });
}

/** The agent's skill links in prompt order, each with its per-agent enabled flag. */
export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: agentSkillKeys.links(agentId ?? ""),
    queryFn: () => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

/**
 * Replace the agent's whole ordered skill list. Optimistic (the list reorders at
 * once, rolls back on error); `scope` runs one agent's saves in order, so a fast
 * drag-then-toggle can't land out of sequence. Each save bumps the agent's version.
 */
export function useSetAgentSkills(agentId: string) {
  const qc = useQueryClient();
  const key = agentSkillKeys.links(agentId);
  return useMutation({
    scope: { id: `agent-skills:${agentId}` },
    mutationFn: (links: AgentSkillLinkInput[]) => {
      const body: AgentSkillsUpdate = { links };
      return api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, body);
    },
    onMutate: async (links) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<AgentSkillLink[]>(key);
      qc.setQueryData<AgentSkillLink[]>(
        key,
        links.map((l, order) => ({ agent_id: agentId, skill_id: l.skill_id, enabled: l.enabled, order })),
      );
      return { previous };
    },
    onError: (_err, _links, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSuccess: (data) => qc.setQueryData(key, data),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["agents"] });
      void qc.invalidateQueries({ queryKey: ["agent", agentId] });
      void qc.invalidateQueries({ queryKey: skillKeys.all });
    },
  });
}
