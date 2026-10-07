import { and, asc, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { isUniqueViolation } from '../../db/pg-errors.js';
import * as t from '../../db/schema.js';
import {
  ACTIVE_SCAN_STATUSES,
  type ConventionPatch,
  type ConventionRecord,
  type ConventionScanFailure,
  type ConventionScanRecord,
  type ConventionScanResult,
  type FinalCandidate,
  type NewConventionScan,
} from './domain.js';
import type { ConventionStore } from './ports.js';

/** The partial unique index that allows one `queued`/`running` scan per repo. */
const ONE_ACTIVE_SCAN = 'convention_scans_repo_active_uq';

const isActive = inArray(t.conventionScans.status, [...ACTIVE_SCAN_STATUSES]);

/** Most confident first; legacy rows without a confidence last, then oldest first. */
const BY_CONFIDENCE = [
  sql`${t.conventions.confidence} desc nulls last`,
  asc(t.conventions.createdAt),
  asc(t.conventions.id),
];

/**
 * Conventions data access: `conventions` (candidates) and `convention_scans`.
 * Workspace-scoped throughout, except the boot reaper.
 */
export class ConventionsRepository implements ConventionStore {
  constructor(private db: Db) {}

  async latestScan(workspaceId: string, repoId: string): Promise<ConventionScanRecord | undefined> {
    return this.newestScan(workspaceId, repoId);
  }

  async latestDoneScan(workspaceId: string, repoId: string): Promise<ConventionScanRecord | undefined> {
    return this.newestScan(workspaceId, repoId, eq(t.conventionScans.status, 'done'));
  }

  async activeScan(workspaceId: string, repoId: string): Promise<ConventionScanRecord | undefined> {
    return this.newestScan(workspaceId, repoId, isActive);
  }

  /** The partial unique index turns a second active scan for the repo into `active_exists`. */
  async insertQueuedScan(scan: NewConventionScan): Promise<ConventionScanRecord | 'active_exists'> {
    try {
      const [row] = await this.db
        .insert(t.conventionScans)
        .values({ ...scan, status: 'queued' })
        .returning();
      return row!;
    } catch (err) {
      if (isUniqueViolation(err, ONE_ACTIVE_SCAN)) return 'active_exists';
      throw err;
    }
  }

  async setJobId(workspaceId: string, scanId: string, jobId: string): Promise<void> {
    await this.db
      .update(t.conventionScans)
      .set({ jobId })
      .where(and(eq(t.conventionScans.workspaceId, workspaceId), eq(t.conventionScans.id, scanId)));
  }

  async markRunning(workspaceId: string, scanId: string): Promise<ConventionScanRecord | undefined> {
    const [row] = await this.db
      .update(t.conventionScans)
      .set({ status: 'running', startedAt: new Date() })
      .where(and(eq(t.conventionScans.workspaceId, workspaceId), eq(t.conventionScans.id, scanId), isActive))
      .returning();
    return row;
  }

  async failScan(workspaceId: string, scanId: string, failure: ConventionScanFailure): Promise<void> {
    const { usage } = failure;
    await this.db
      .update(t.conventionScans)
      .set({
        status: 'failed',
        error: failure.error,
        finishedAt: new Date(),
        ...(usage && { tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, costUsd: usage.costUsd }),
      })
      .where(and(eq(t.conventionScans.workspaceId, workspaceId), eq(t.conventionScans.id, scanId), isActive));
  }

  /** Global on purpose, like `JobRunner.reapStale`: one API instance per database. */
  async reapActiveScans(error: string): Promise<number> {
    const rows = await this.db
      .update(t.conventionScans)
      .set({ status: 'failed', error, finishedAt: new Date() })
      .where(isActive)
      .returning({ id: t.conventionScans.id });
    return rows.length;
  }

  async listVisible(workspaceId: string, repoId: string): Promise<ConventionRecord[]> {
    return this.listWhere(workspaceId, repoId, ne(t.conventions.status, 'rejected'));
  }

  async listAccepted(workspaceId: string, repoId: string): Promise<ConventionRecord[]> {
    return this.listWhere(workspaceId, repoId, eq(t.conventions.status, 'accepted'));
  }

  async listDecided(workspaceId: string, repoId: string): Promise<ConventionRecord[]> {
    return this.listWhere(workspaceId, repoId, inArray(t.conventions.status, ['accepted', 'rejected']));
  }

  /**
   * Replace the pending candidates and finish the scan, atomically. The scan row
   * is locked first, so a scan failed meanwhile stays failed and writes nothing.
   * A candidate whose fingerprint the repo already has (a decided one, or a
   * concurrent write) is skipped by the (repo_id, fingerprint) unique index.
   */
  async completeScan(
    workspaceId: string,
    scanId: string,
    result: ConventionScanResult,
    candidates: FinalCandidate[],
  ): Promise<ConventionScanRecord | undefined> {
    return this.db.transaction(async (tx) => {
      const [scan] = await tx
        .select({ repoId: t.conventionScans.repoId })
        .from(t.conventionScans)
        .where(
          and(
            eq(t.conventionScans.workspaceId, workspaceId),
            eq(t.conventionScans.id, scanId),
            eq(t.conventionScans.status, 'running'),
          ),
        )
        .for('update');
      if (!scan) return undefined;
      await tx
        .delete(t.conventions)
        .where(
          and(
            eq(t.conventions.workspaceId, workspaceId),
            eq(t.conventions.repoId, scan.repoId),
            eq(t.conventions.status, 'pending'),
          ),
        );
      const inserted =
        candidates.length === 0
          ? []
          : await tx
              .insert(t.conventions)
              .values(
                candidates.map((c) => ({
                  workspaceId,
                  repoId: scan.repoId,
                  category: c.category,
                  rule: c.rule,
                  evidencePath: c.path,
                  evidenceStartLine: c.startLine,
                  evidenceEndLine: c.endLine,
                  evidenceSnippet: c.snippet,
                  confidence: c.confidence,
                  status: 'pending' as const,
                  accepted: false,
                  fingerprint: c.fingerprint,
                })),
              )
              .onConflictDoNothing({ target: [t.conventions.repoId, t.conventions.fingerprint] })
              .returning({ id: t.conventions.id });
      const [row] = await tx
        .update(t.conventionScans)
        .set({ ...result, candidatesKept: inserted.length, status: 'done', error: null, finishedAt: new Date() })
        .where(eq(t.conventionScans.id, scanId))
        .returning();
      return row;
    });
  }

  async update(workspaceId: string, id: string, patch: ConventionPatch): Promise<ConventionRecord | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  async resetAccepted(workspaceId: string, repoId: string): Promise<number> {
    const rows = await this.db
      .update(t.conventions)
      .set({ status: 'pending', accepted: false, updatedAt: new Date() })
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.status, 'accepted'),
        ),
      )
      .returning({ id: t.conventions.id });
    return rows.length;
  }

  private async newestScan(
    workspaceId: string,
    repoId: string,
    status?: SQL,
  ): Promise<ConventionScanRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventionScans)
      .where(and(eq(t.conventionScans.workspaceId, workspaceId), eq(t.conventionScans.repoId, repoId), status))
      .orderBy(desc(t.conventionScans.createdAt))
      .limit(1);
    return row;
  }

  private listWhere(workspaceId: string, repoId: string, status: SQL): Promise<ConventionRecord[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId), status))
      .orderBy(...BY_CONFIDENCE);
  }
}
