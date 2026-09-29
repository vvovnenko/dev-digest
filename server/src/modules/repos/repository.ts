import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { NewRepo, RepoStore } from './ports.js';

/**
 * F1 — repos data-access layer. The ONLY place that touches the `repos`
 * table. Every query is scoped by `workspaceId` (tenancy guard).
 */

export type RepoRow = typeof t.repos.$inferSelect;

export class RepoRepository implements RepoStore {
  constructor(private db: Db) {}

  /** Find a repo in a workspace by its `owner/name` full name (dedupe on add). */
  /** GitHub names are case-insensitive, and so is the unique index this matches. */
  async findByFullName(workspaceId: string, fullName: string): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), sql`lower(${t.repos.fullName}) = lower(${fullName})`));
    return row;
  }

  async list(workspaceId: string): Promise<RepoRow[]> {
    return this.db.select().from(t.repos).where(eq(t.repos.workspaceId, workspaceId));
  }

  async getById(workspaceId: string, id: string): Promise<RepoRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, id)));
    return row;
  }

  /**
   * Insert the repo unless the workspace already has it (any letter case).
   * Race-safe: two concurrent adds of the same repo both succeed — one creates
   * it, the other gets the existing row with `created: false`.
   */
  async insertIfAbsent(values: NewRepo): Promise<{ row: RepoRow; created: boolean }> {
    const [row] = await this.db
      .insert(t.repos)
      .values({
        workspaceId: values.workspaceId,
        owner: values.owner,
        name: values.name,
        fullName: values.fullName,
        createdBy: values.createdBy,
      })
      .onConflictDoNothing()
      .returning();
    if (row) return { row, created: true };
    const existing = await this.findByFullName(values.workspaceId, values.fullName);
    if (!existing) throw new Error(`repo ${values.fullName} conflicted on insert but was not found`);
    return { row: existing, created: false };
  }

  /**
   * Look up the workspace owning a repo (by repo id, no tenancy scope —
   * the JobRunner's `runCloneJob` is the only caller and it already trusted
   * the payload that came out of an authenticated `add()`). Returns null
   * if the repo was deleted before the followup ran.
   */
  async workspaceIdFor(repoId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ workspaceId: t.repos.workspaceId })
      .from(t.repos)
      .where(eq(t.repos.id, repoId));
    return row?.workspaceId ?? null;
  }

  /** Persist the clone path (and default branch, when known) and bump `last_polled_at` once a clone job completes. */
  async updateClonePath(repoId: string, clonePath: string, defaultBranch?: string): Promise<void> {
    await this.db
      .update(t.repos)
      .set({ clonePath, lastPolledAt: new Date(), ...(defaultBranch ? { defaultBranch } : {}) })
      .where(eq(t.repos.id, repoId));
  }

  async remove(workspaceId: string, id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, id)))
      .returning({ id: t.repos.id });
    return deleted.length > 0;
  }
}
