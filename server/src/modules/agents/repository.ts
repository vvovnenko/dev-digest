import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Db, DbExecutor } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { DEFAULT_AGENT_DESCRIPTION, INITIAL_AGENT_VERSION } from './constants.js';
import { isConfigChange, skillsChanged } from './domain.js';
import type { AgentPatch, AgentStore, NewAgent } from './ports.js';

/**
 * A2 — agents data-access. Owns `agents`, `agent_versions`, and the
 * `agent_skills` link table (shared with A1's skills repository, but A2 owns the
 * agent side: link/reorder/list for an agent). Workspace-scoped throughout.
 */

import type { AgentRow, AgentVersionRow } from '../../db/rows.js';
export type { AgentRow, AgentVersionRow };

/** A skill linked to an agent (with its order), joined from agent_skills. */
export interface LinkedSkillRow {
  skill: typeof t.skills.$inferSelect;
  order: number;
}

export class AgentsRepository implements AgentStore {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<AgentRow[]> {
    return this.db.select().from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
  }

  async listEnabled(workspaceId: string): Promise<AgentRow[]> {
    return this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.enabled, true)));
  }

  async getById(workspaceId: string, id: string): Promise<AgentRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)));
    return row;
  }

  /** Delete an agent (scoped to workspace). Versions/skill-links cascade;
   *  agent_runs keep their history with agent_id set null. Returns false if
   *  no such agent existed in the workspace. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
      .returning({ id: t.agents.id });
    return rows.length > 0;
  }

  /** Insert an agent AND record version 1 in agent_versions (immutable snapshot), atomically. */
  async insert(values: NewAgent): Promise<AgentRow> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(t.agents)
        .values({
          workspaceId: values.workspaceId,
          name: values.name,
          description: values.description ?? DEFAULT_AGENT_DESCRIPTION,
          provider: values.provider,
          model: values.model,
          systemPrompt: values.systemPrompt,
          outputSchema: (values.outputSchema as object | undefined) ?? null,
          ...(values.strategy !== undefined ? { strategy: values.strategy } : {}),
          ...(values.ciFailOn !== undefined ? { ciFailOn: values.ciFailOn } : {}),
          ...(values.repoIntel !== undefined ? { repoIntel: values.repoIntel } : {}),
          enabled: values.enabled ?? true,
          version: INITIAL_AGENT_VERSION,
          createdBy: values.createdBy ?? null,
        })
        .returning();
      await this.snapshotVersion(tx, row!, INITIAL_AGENT_VERSION);
      return row!;
    });
  }

  /**
   * Update an agent. Any config change bumps the version and snapshots the new
   * config into agent_versions (reproducibility for eval). The row is locked
   * for the read-decide-write, so two concurrent edits get two versions.
   */
  async update(
    workspaceId: string,
    id: string,
    patch: AgentPatch,
  ): Promise<AgentRow | undefined> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(t.agents)
        .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
        .for('update');
      if (!existing) return undefined;

      // A config-affecting change (anything except just toggling enabled) bumps version.
      const configChanged = isConfigChange(existing, patch);
      const nextVersion = configChanged ? existing.version + 1 : existing.version;

      const [row] = await tx
        .update(t.agents)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
          ...(patch.model !== undefined ? { model: patch.model } : {}),
          ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {}),
          ...(patch.outputSchema !== undefined
            ? { outputSchema: patch.outputSchema as object }
            : {}),
          ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
          ...(patch.ciFailOn !== undefined ? { ciFailOn: patch.ciFailOn } : {}),
          ...(patch.repoIntel !== undefined ? { repoIntel: patch.repoIntel } : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          ...(configChanged ? { version: nextVersion } : {}),
        })
        .where(eq(t.agents.id, id))
        .returning();

      if (configChanged && row) await this.snapshotVersion(tx, row, nextVersion);
      return row;
    });
  }

  /** Record `version` of the agent's config, skills included. A conflict is an error, not a silent skip. */
  private async snapshotVersion(exec: DbExecutor, row: AgentRow, version: number): Promise<void> {
    const skills = await this.skillIdsForAgent(row.id, exec);
    await exec.insert(t.agentVersions).values({
      agentId: row.id,
      version,
      configJson: {
        provider: row.provider,
        model: row.model,
        system_prompt: row.systemPrompt,
        output_schema: row.outputSchema,
        strategy: row.strategy,
        ci_fail_on: row.ciFailOn,
        repo_intel: row.repoIntel,
        skills,
      },
    });
  }

  // ---- agent_versions (immutable config snapshots) ------------------------

  /** All config snapshots for an agent, newest version first. */
  async listVersions(agentId: string): Promise<AgentVersionRow[]> {
    return this.db
      .select()
      .from(t.agentVersions)
      .where(eq(t.agentVersions.agentId, agentId))
      .orderBy(desc(t.agentVersions.version));
  }

  /** A single config snapshot, or undefined if that version was never recorded. */
  async getVersion(agentId: string, version: number): Promise<AgentVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agentVersions)
      .where(and(eq(t.agentVersions.agentId, agentId), eq(t.agentVersions.version, version)));
    return row;
  }

  // ---- agent_skills link table (A2 owns the agent side) -------------------

  /** Skills linked to an agent, in `order` ascending. */
  async linkedSkills(agentId: string, exec: DbExecutor = this.db): Promise<LinkedSkillRow[]> {
    const rows = await exec
      .select({ skill: t.skills, order: t.agentSkills.order })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(eq(t.agentSkills.agentId, agentId))
      .orderBy(asc(t.agentSkills.order));
    return rows.map((r) => ({ skill: r.skill, order: r.order }));
  }

  async skillLinks(agentId: string): Promise<{ skillId: string; order: number }[]> {
    const links = await this.linkedSkills(agentId);
    return links.map((l) => ({ skillId: l.skill.id, order: l.order }));
  }

  async skillsInWorkspace(workspaceId: string, skillIds: string[]): Promise<string[]> {
    if (skillIds.length === 0) return [];
    const rows = await this.db
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), inArray(t.skills.id, skillIds)));
    return rows.map((r) => r.id);
  }

  async skillIdsForAgent(agentId: string, exec: DbExecutor = this.db): Promise<string[]> {
    const links = await this.linkedSkills(agentId, exec);
    return links.map((l) => l.skill.id);
  }

  /**
   * Change an agent's linked skills to `change(current ids)`, in that order —
   * atomically: the old links, the new ones and (when the list differs) the
   * version bump + snapshot commit together, so a failed insert can't leave
   * the agent with no skills. Returns false when the agent isn't in the workspace.
   */
  async replaceSkills(
    workspaceId: string,
    agentId: string,
    change: (current: string[]) => string[],
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [agent] = await tx
        .select()
        .from(t.agents)
        .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)))
        .for('update');
      if (!agent) return false;
      const current = await this.skillIdsForAgent(agentId, tx);
      const next = change(current);
      if (!skillsChanged(current, next)) return true;

      await tx.delete(t.agentSkills).where(eq(t.agentSkills.agentId, agentId));
      if (next.length > 0) {
        await tx.insert(t.agentSkills).values(next.map((skillId, i) => ({ agentId, skillId, order: i })));
      }
      // Skills are part of the versioned config.
      const [row] = await tx
        .update(t.agents)
        .set({ version: agent.version + 1 })
        .where(eq(t.agents.id, agentId))
        .returning();
      await this.snapshotVersion(tx, row!, row!.version);
      return true;
    });
  }
}
