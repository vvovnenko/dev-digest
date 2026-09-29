import type { CiFailOn, Provider, ReviewStrategy } from '@devdigest/shared';

/**
 * Agent versioning rules. An agent's version is a reproducibility handle for
 * eval: every change to what the agent reviews WITH creates a new immutable
 * snapshot. Pure — the repository applies these inside its transaction.
 */

/** The config fields a version covers (everything except `enabled`). */
export interface AgentConfig {
  name: string;
  description: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  strategy: ReviewStrategy;
  ciFailOn: CiFailOn;
  repoIntel: boolean;
}

/** A stored agent, as the agents service (and, structurally, reviews) reads it. */
export interface AgentRecord extends AgentConfig {
  id: string;
  workspaceId: string;
  outputSchema: unknown;
  enabled: boolean;
  version: number;
}

/** One immutable config snapshot of an agent; `configJson` is untyped until parsed. */
export interface AgentVersionRecord {
  agentId: string;
  version: number;
  configJson: unknown;
  createdAt: Date;
}

/** Fields a patch may change; `outputSchema` always counts as a change. */
export interface ConfigChangePatch extends Partial<AgentConfig> {
  outputSchema?: unknown;
}

/**
 * True when a patch changes config (vs. just toggling `enabled`) relative to the
 * current agent — a config change bumps the version and snapshots agent_versions.
 */
export function isConfigChange(current: AgentConfig, patch: ConfigChangePatch): boolean {
  const keys: (keyof AgentConfig)[] = [
    'name',
    'description',
    'provider',
    'model',
    'systemPrompt',
    'strategy',
    'ciFailOn',
    'repoIntel',
  ];
  return keys.some((k) => patch[k] !== undefined && patch[k] !== current[k]) || patch.outputSchema !== undefined;
}

/**
 * Skills are part of the versioned config (the snapshot records them), so a
 * different set or order is a new version too.
 */
export function skillsChanged(before: readonly string[], after: readonly string[]): boolean {
  return before.length !== after.length || before.some((id, i) => id !== after[i]);
}

/** `ids` with `skillId` moved to (or inserted at) `order`; the end when order is omitted. */
export function withSkillAt(ids: readonly string[], skillId: string, order?: number): string[] {
  const rest = ids.filter((id) => id !== skillId);
  const at = Math.max(0, Math.min(order ?? rest.length, rest.length));
  return [...rest.slice(0, at), skillId, ...rest.slice(at)];
}
