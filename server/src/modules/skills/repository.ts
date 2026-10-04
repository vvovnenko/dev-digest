import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { isUniqueViolation } from '../../db/pg-errors.js';
import { INITIAL_SKILL_VERSION, type SkillChange, type SkillRecord, type SkillVersionRecord } from './domain.js';
import type { NewSkill, SkillStore, SkillUse } from './ports.js';

/** The unique index on (workspace_id, name) — migration 0015. */
const NAME_UNIQUE = 'skills_ws_name_uq';

/**
 * Skills data access: `skills` and `skill_versions`, plus read-only counts over
 * the `agent_skills` links (the agents repository owns writing those).
 * Workspace-scoped throughout.
 */
export class SkillsRepository implements SkillStore {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<SkillRecord[]> {
    return this.db.select().from(t.skills).where(eq(t.skills.workspaceId, workspaceId)).orderBy(asc(t.skills.name));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  async nameExists(workspaceId: string, name: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: t.skills.id })
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, name)));
    return row !== undefined;
  }

  async agentCounts(workspaceId: string, skillIds?: string[]): Promise<Map<string, number>> {
    if (skillIds && skillIds.length === 0) return new Map();
    const rows = await this.db
      .select({ skillId: t.agentSkills.skillId, n: count() })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agents.id, t.agentSkills.agentId))
      .where(
        and(
          eq(t.agents.workspaceId, workspaceId),
          eq(t.agentSkills.enabled, true),
          ...(skillIds ? [inArray(t.agentSkills.skillId, skillIds)] : []),
        ),
      )
      .groupBy(t.agentSkills.skillId);
    return new Map(rows.map((r) => [r.skillId, r.n]));
  }

  /** The skill and its v1 snapshot, in one transaction. */
  async insert(values: NewSkill, note: string): Promise<SkillRecord | 'name_taken'> {
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(t.skills)
          .values({ ...values, version: INITIAL_SKILL_VERSION })
          .returning();
        await tx.insert(t.skillVersions).values({
          skillId: row!.id,
          version: INITIAL_SKILL_VERSION,
          name: row!.name,
          description: row!.description,
          type: row!.type,
          body: row!.body,
          note,
        });
        return row!;
      });
    } catch (err) {
      if (isUniqueViolation(err, NAME_UNIQUE)) return 'name_taken';
      throw err;
    }
  }

  /** Read → decide → write under a row lock, so two edits get two versions. */
  async update(
    workspaceId: string,
    id: string,
    decide: (current: SkillRecord) => SkillChange | null,
  ): Promise<SkillRecord | 'name_taken' | undefined> {
    try {
      return await this.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(t.skills)
          .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
          .for('update');
        if (!current) return undefined;
        const change = decide(current);
        if (!change) return current;

        const [row] = await tx.update(t.skills).set(change.set).where(eq(t.skills.id, id)).returning();
        if (change.snapshot) {
          await tx.insert(t.skillVersions).values({
            skillId: id,
            version: change.snapshot.version,
            ...change.snapshot.content,
            note: change.snapshot.note,
          });
        }
        return row;
      });
    } catch (err) {
      if (isUniqueViolation(err, NAME_UNIQUE)) return 'name_taken';
      throw err;
    }
  }

  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  async listVersions(
    workspaceId: string,
    skillId: string,
    page: { limit: number; offset: number },
  ): Promise<SkillVersionRecord[]> {
    const rows = await this.db
      .select({ v: t.skillVersions })
      .from(t.skillVersions)
      .innerJoin(t.skills, eq(t.skills.id, t.skillVersions.skillId))
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skillVersions.skillId, skillId)))
      .orderBy(desc(t.skillVersions.version))
      .limit(page.limit)
      .offset(page.offset);
    return rows.map((r) => r.v);
  }

  async getVersion(workspaceId: string, skillId: string, version: number): Promise<SkillVersionRecord | undefined> {
    const [row] = await this.db
      .select({ v: t.skillVersions })
      .from(t.skillVersions)
      .innerJoin(t.skills, eq(t.skills.id, t.skillVersions.skillId))
      .where(
        and(
          eq(t.skills.workspaceId, workspaceId),
          eq(t.skillVersions.skillId, skillId),
          eq(t.skillVersions.version, version),
        ),
      );
    return row?.v;
  }

  async agentsUsing(workspaceId: string, skillId: string): Promise<SkillUse[]> {
    return this.db
      .select({
        agentId: t.agents.id,
        agentName: t.agents.name,
        agentEnabled: t.agents.enabled,
        order: t.agentSkills.order,
      })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agents.id, t.agentSkills.agentId))
      .where(
        and(
          eq(t.agents.workspaceId, workspaceId),
          eq(t.agentSkills.skillId, skillId),
          eq(t.agentSkills.enabled, true),
        ),
      )
      .orderBy(asc(t.agents.name));
  }
}
