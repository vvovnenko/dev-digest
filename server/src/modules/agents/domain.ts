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

/** One entry of an agent's ordered skill list; off = kept in place, left out of the prompt. */
export interface SkillLink {
  skillId: string;
  enabled: boolean;
}

/**
 * Skills are part of the versioned config (the snapshot records them), so a
 * different set, order or per-agent flag is a new version too.
 */
export function linksChanged(before: readonly SkillLink[], after: readonly SkillLink[]): boolean {
  return (
    before.length !== after.length ||
    before.some((l, i) => l.skillId !== after[i]!.skillId || l.enabled !== after[i]!.enabled)
  );
}

/**
 * `links` with `skillId` moved to (or inserted at) `order`; the end when order is
 * omitted. A moved link keeps its flag; a new one starts enabled.
 */
export function withSkillAt(links: readonly SkillLink[], skillId: string, order?: number): SkillLink[] {
  const existing = links.find((l) => l.skillId === skillId);
  const rest = links.filter((l) => l.skillId !== skillId);
  const at = Math.max(0, Math.min(order ?? rest.length, rest.length));
  const link: SkillLink = { skillId, enabled: existing?.enabled ?? true };
  return [...rest.slice(0, at), link, ...rest.slice(at)];
}

/** The ids that reach the prompt (enabled links), in order — the snapshot's `skills`. */
export function enabledSkillIds(links: readonly SkillLink[]): string[] {
  return links.filter((l) => l.enabled).map((l) => l.skillId);
}
