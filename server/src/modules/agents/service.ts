import type {
  Agent,
  AgentCreate,
  AgentSkillLink,
  AgentSkillLinkInput,
  AgentUpdate,
  AgentVersion,
  ModelInfo,
  Provider,
} from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { toAgentDto, toAgentVersionDto } from './helpers.js';
import { withSkillAt } from './domain.js';
import type { AgentDeps } from './ports.js';

/**
 * A2 — agents service. Business logic for the Agents tab + Agent Editor.
 * Provider/model selection uses the LLM adapter's dynamic model list.
 *
 * An Agent = provider + model + system_prompt + linked skills + output_schema +
 * enabled. Config changes are versioned via `agent_versions` (repository).
 */

// Re-exported for backwards compatibility; implementation lives in ./helpers.
export { toAgentDto } from './helpers.js';

/** The request bodies, as the API contract defines them. */
export type CreateAgentInput = AgentCreate;
export type UpdateAgentInput = AgentUpdate;

export class AgentsService {
  constructor(private deps: AgentDeps) {}

  async list(workspaceId: string): Promise<Agent[]> {
    const [rows, counts] = await Promise.all([
      this.deps.agents.list(workspaceId),
      this.deps.agents.skillCounts(workspaceId),
    ]);
    return rows.map((row) => toAgentDto(row, counts.get(row.id) ?? 0));
  }

  async get(workspaceId: string, id: string): Promise<Agent | undefined> {
    const row = await this.deps.agents.getById(workspaceId, id);
    return row ? toAgentDto(row, await this.skillCount(workspaceId, id)) : undefined;
  }

  /** The agent's enabled skill links. */
  private async skillCount(workspaceId: string, agentId: string): Promise<number> {
    const counts = await this.deps.agents.skillCounts(workspaceId, [agentId]);
    return counts.get(agentId) ?? 0;
  }

  /** Delete an agent (and its versions/skill-links, via cascade). */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.deps.agents.deleteById(workspaceId, id);
  }

  async create(workspaceId: string, input: CreateAgentInput, userId?: string): Promise<Agent> {
    const row = await this.deps.agents.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      provider: input.provider,
      model: input.model,
      systemPrompt: input.system_prompt,
      outputSchema: input.output_schema,
      ...(input.strategy !== undefined ? { strategy: input.strategy } : {}),
      ...(input.ci_fail_on !== undefined ? { ciFailOn: input.ci_fail_on } : {}),
      ...(input.repo_intel !== undefined ? { repoIntel: input.repo_intel } : {}),
      enabled: input.enabled,
      createdBy: userId ?? null,
    });
    return toAgentDto(row, 0);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgentInput,
  ): Promise<Agent | undefined> {
    const row = await this.deps.agents.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.system_prompt !== undefined ? { systemPrompt: patch.system_prompt } : {}),
      ...(patch.output_schema !== undefined ? { outputSchema: patch.output_schema } : {}),
      ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
      ...(patch.ci_fail_on !== undefined ? { ciFailOn: patch.ci_fail_on } : {}),
      ...(patch.repo_intel !== undefined ? { repoIntel: patch.repo_intel } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    });
    return row ? toAgentDto(row, await this.skillCount(workspaceId, id)) : undefined;
  }

  /**
   * Config history for an agent, newest version first. Workspace-scoped: returns
   * undefined when the agent isn't in this workspace (the route maps that to 404)
   * so version snapshots can't be read across tenants.
   */
  async listVersions(workspaceId: string, agentId: string): Promise<AgentVersion[] | undefined> {
    const agent = await this.deps.agents.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const rows = await this.deps.agents.listVersions(agentId);
    return rows.map(toAgentVersionDto);
  }

  /**
   * A single config snapshot for an agent. Returns undefined when the agent isn't
   * in this workspace OR that version was never recorded (route → 404).
   */
  async getVersion(
    workspaceId: string,
    agentId: string,
    version: number,
  ): Promise<AgentVersion | undefined> {
    const agent = await this.deps.agents.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const row = await this.deps.agents.getVersion(agentId, version);
    return row ? toAgentVersionDto(row) : undefined;
  }

  /** Linked skills for an agent as AgentSkillLink[] (ordered, with the per-agent flag). */
  async skillLinks(agentId: string): Promise<AgentSkillLink[]> {
    const links = await this.deps.agents.skillLinks(agentId);
    return links.map((l) => ({ agent_id: agentId, skill_id: l.skillId, order: l.order, enabled: l.enabled }));
  }

  /** Linking a skill from another workspace (or a made-up id) is a 404, not a DB error. */
  private async assertSkillsInWorkspace(workspaceId: string, skillIds: string[]): Promise<void> {
    const wanted = [...new Set(skillIds)];
    const found = await this.deps.agents.skillsInWorkspace(workspaceId, wanted);
    if (found.length !== wanted.length) throw new NotFoundError('Skill not found');
  }

  /**
   * Replace the agent's whole skill list: array order = prompt order, each link
   * with its per-agent flag (the agent editor's Skills tab sends this).
   */
  async setSkillLinks(
    workspaceId: string,
    agentId: string,
    links: AgentSkillLinkInput[],
  ): Promise<AgentSkillLink[] | undefined> {
    await this.assertSkillsInWorkspace(workspaceId, links.map((l) => l.skill_id));
    const next = links.map((l) => ({ skillId: l.skill_id, enabled: l.enabled }));
    const found = await this.deps.agents.replaceSkills(workspaceId, agentId, () => next);
    if (!found) return undefined;
    return this.skillLinks(agentId);
  }

  /** Set / reorder the linked skills by id, every link enabled. */
  async setSkills(
    workspaceId: string,
    agentId: string,
    skillIds: string[],
  ): Promise<AgentSkillLink[] | undefined> {
    return this.setSkillLinks(
      workspaceId,
      agentId,
      skillIds.map((skill_id) => ({ skill_id, enabled: true })),
    );
  }

  /** Link a single skill (append or set order) — additive to existing links. */
  async linkSkill(
    workspaceId: string,
    agentId: string,
    skillId: string,
    order?: number,
  ): Promise<AgentSkillLink[] | undefined> {
    await this.assertSkillsInWorkspace(workspaceId, [skillId]);
    const found = await this.deps.agents.replaceSkills(workspaceId, agentId, (links) =>
      withSkillAt(links, skillId, order),
    );
    if (!found) return undefined;
    return this.skillLinks(agentId);
  }

  /**
   * Dynamic model list from the provider adapter's /models. Degrades gracefully
   * to [] if the provider key is not configured (the editor still renders).
   */
  async listModels(provider: Provider): Promise<ModelInfo[]> {
    try {
      const llm = await this.deps.llm(provider);
      return await llm.listModels();
    } catch {
      return [];
    }
  }
}
