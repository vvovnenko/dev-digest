import { and, eq, inArray, notInArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import {
  ACTIVE_INTENT_STATUSES,
  type IntentFailure,
  type IntentRecord,
  type IntentResult,
  type NewIntentAttempt,
} from './domain.js';
import type { IntentStore } from './ports.js';

const ACTIVE = [...ACTIVE_INTENT_STATUSES];

const forPr = (workspaceId: string, prId: string) =>
  and(eq(t.prIntent.workspaceId, workspaceId), eq(t.prIntent.prId, prId));

/**
 * Intent data access: `pr_intent`, one row per PR. Workspace-scoped throughout,
 * except the boot reaper. Each method is one statement, so each is its own
 * consistency boundary; the status guards in the `where` are what keep a late
 * writer (a job whose attempt was reaped) from overwriting a newer state.
 */
export class IntentRepository implements IntentStore {
  constructor(private db: Db) {}

  async get(workspaceId: string, prId: string): Promise<IntentRecord | undefined> {
    const [row] = await this.db.select().from(t.prIntent).where(forPr(workspaceId, prId));
    return row;
  }

  /**
   * One upsert: a new row, or the existing one reset for a new attempt — unless an
   * attempt is active, in which case the conflict updates nothing and no row comes back.
   * The last result (`intent` … `derivedAt`) is never touched.
   */
  async claim(attempt: NewIntentAttempt): Promise<IntentRecord | undefined> {
    const { workspaceId, prId, provider, model } = attempt;
    const now = new Date();
    const fresh = {
      status: 'queued' as const,
      error: null,
      jobId: null,
      provider,
      model,
      tokensIn: null,
      tokensOut: null,
      costUsd: null,
      requestedAt: now,
      finishedAt: null,
    };
    const [row] = await this.db
      .insert(t.prIntent)
      .values({ workspaceId, prId, ...fresh })
      .onConflictDoUpdate({
        target: t.prIntent.prId,
        set: fresh,
        setWhere: and(eq(t.prIntent.workspaceId, workspaceId), notInArray(t.prIntent.status, ACTIVE))!,
      })
      .returning();
    return row;
  }

  async setJobId(workspaceId: string, prId: string, jobId: string): Promise<void> {
    await this.db.update(t.prIntent).set({ jobId }).where(forPr(workspaceId, prId));
  }

  async markRunning(workspaceId: string, prId: string): Promise<IntentRecord | undefined> {
    const [row] = await this.db
      .update(t.prIntent)
      .set({ status: 'running' })
      .where(and(forPr(workspaceId, prId), inArray(t.prIntent.status, ACTIVE)))
      .returning();
    return row;
  }

  async complete(workspaceId: string, prId: string, result: IntentResult): Promise<IntentRecord | undefined> {
    const now = new Date();
    const [row] = await this.db
      .update(t.prIntent)
      .set({ ...result, status: 'done', error: null, finishedAt: now, derivedAt: now })
      .where(and(forPr(workspaceId, prId), eq(t.prIntent.status, 'running')))
      .returning();
    return row;
  }

  async fail(workspaceId: string, prId: string, failure: IntentFailure): Promise<void> {
    const { usage } = failure;
    await this.db
      .update(t.prIntent)
      .set({
        status: 'failed',
        error: failure.error,
        finishedAt: new Date(),
        ...(usage && { tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, costUsd: usage.costUsd }),
      })
      .where(and(forPr(workspaceId, prId), inArray(t.prIntent.status, ACTIVE)));
  }

  /** Global on purpose, like `JobRunner.reapStale`: one API instance per database. */
  async reapActive(error: string): Promise<number> {
    const rows = await this.db
      .update(t.prIntent)
      .set({ status: 'failed', error, finishedAt: new Date() })
      .where(inArray(t.prIntent.status, ACTIVE))
      .returning({ prId: t.prIntent.prId });
    return rows.length;
  }
}
