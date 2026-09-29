import type { CiFailOn, LLMProvider, Provider, ReviewStrategy } from '@devdigest/shared';
import type { AgentRecord, AgentVersionRecord } from './domain.js';

export interface NewAgent {
  workspaceId: string;
  name: string;
  description?: string | undefined;
  provider: Provider;
  model: string;
  systemPrompt: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy | undefined;
  ciFailOn?: CiFailOn | undefined;
  repoIntel?: boolean | undefined;
  enabled?: boolean | undefined;
  createdBy?: string | null | undefined;
}

export interface AgentPatch {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  systemPrompt?: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
}

export interface AgentStore {
  list(workspaceId: string): Promise<AgentRecord[]>;
  getById(workspaceId: string, id: string): Promise<AgentRecord | undefined>;
  deleteById(workspaceId: string, id: string): Promise<boolean>;
  /** Creates version 1 and its snapshot together. */
  insert(values: NewAgent): Promise<AgentRecord>;
  /** A config change bumps the version and snapshots it, under a row lock. */
  update(workspaceId: string, id: string, patch: AgentPatch): Promise<AgentRecord | undefined>;
  listVersions(agentId: string): Promise<AgentVersionRecord[]>;
  getVersion(agentId: string, version: number): Promise<AgentVersionRecord | undefined>;
  /** The agent's skill ids with their order, ascending. */
  skillLinks(agentId: string): Promise<{ skillId: string; order: number }[]>;
  /** Which of `skillIds` exist in the workspace. */
  skillsInWorkspace(workspaceId: string, skillIds: string[]): Promise<string[]>;
  /** Replace the linked skills with `change(current)`; false when the agent isn't in the workspace. */
  replaceSkills(workspaceId: string, agentId: string, change: (current: string[]) => string[]): Promise<boolean>;
}

export interface AgentDeps {
  agents: AgentStore;
  /** Resolves a provider's client; throws when its key isn't configured. */
  llm: (provider: Provider) => Promise<LLMProvider>;
}
