import PQueue from 'p-queue';
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import * as t from '../db/schema.js';
import { withTimeout, withRetry } from './resilience.js';
import { AppError } from './errors.js';

/**
 * JobRunner — async work (clone, PR import, indexing, polling) on a
 * concurrency-limited p-queue, mirrored into the `jobs` table with
 * timeouts + retry/backoff.
 *
 * Handlers are registered by kind. enqueue() inserts a `jobs` row, schedules
 * the handler on the queue, and updates status/attempts/error as it runs.
 *
 * Jobs whose payload names a `repoId` run one at a time per repo: clone, index,
 * refresh and resync all rewrite the same clone and index tables, and two of
 * them at once collide on unique keys. A request for a job that is already
 * waiting to start (same kind, same repo) joins that job instead of queueing
 * the same work twice.
 */

export type JobHandler = (payload: unknown, ctx: { jobId: string }) => Promise<void>;

export interface JobRunnerOptions {
  concurrency?: number;
  timeoutMs?: number;
  retries?: number;
}

export interface EnqueuedJob {
  id: string;
  /** Resolves when the job finishes (or rejects if it ultimately fails). */
  done: Promise<void>;
}

/** Why a job row ended without running to completion. */
export const JOB_SHUTDOWN_ERROR = 'The API shut down before this job finished';
export const JOB_RESTART_ERROR = 'The API restarted while this job was queued or running';

/** The repo a job works on, when its payload names one. */
function repoOf(payload: unknown): string | undefined {
  const repoId = (payload as { repoId?: unknown } | null | undefined)?.repoId;
  return typeof repoId === 'string' ? repoId : undefined;
}

/**
 * Wait until every call a job made has settled — a timed-out handler keeps
 * running — but no longer than `ms`: past that it is treated as hung.
 */
async function settled(calls: Promise<unknown>[], ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
  await Promise.race([Promise.allSettled(calls), giveUp]);
  clearTimeout(timer);
}

/** Remember a handler call so the repo lock outlives a timeout that abandoned it. */
function track(calls: Promise<void>[], call: Promise<void>): Promise<void> {
  calls.push(call);
  return call;
}

export class JobRunner {
  private queue: PQueue;
  private handlers = new Map<string, JobHandler>();
  private timeoutMs: number;
  private retries: number;
  /** Per repo: settles when the last job enqueued for it has let go of the repo. */
  private repoTails = new Map<string, Promise<void>>();
  /** Jobs not started yet, by `kind:repoId`, so a repeat request joins them. */
  private waiting = new Map<string, Promise<EnqueuedJob>>();
  /** Ids of jobs not started yet (close() fails them). */
  private notStarted = new Set<string>();
  private closing = false;

  constructor(
    private db: Db,
    opts: JobRunnerOptions = {},
  ) {
    this.queue = new PQueue({ concurrency: opts.concurrency ?? 3 });
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    this.retries = opts.retries ?? 2;
  }

  register(kind: string, handler: JobHandler): void {
    this.handlers.set(kind, handler);
  }

  async enqueue(workspaceId: string, kind: string, payload: unknown): Promise<EnqueuedJob> {
    const handler = this.handlers.get(kind);
    if (!handler) throw new Error(`No job handler registered for kind '${kind}'`);
    if (this.closing) throw new AppError('shutting_down', 'The API is shutting down; no new jobs are accepted', 503);

    const repoId = repoOf(payload);
    const key = repoId ? `${kind}:${repoId}` : undefined;
    const same = key ? this.waiting.get(key) : undefined;
    if (same) return same;

    // Registered before the first await, so a concurrent repeat request joins too.
    const forget = () => {
      if (key && this.waiting.get(key) === job) this.waiting.delete(key);
    };
    const job = this.start(workspaceId, kind, payload, handler, repoId, forget);
    if (key) {
      this.waiting.set(key, job);
      job.catch(forget); // the insert failed: nothing to join
    }
    return job;
  }

  private async start(
    workspaceId: string,
    kind: string,
    payload: unknown,
    handler: JobHandler,
    repoId: string | undefined,
    onStart: () => void,
  ): Promise<EnqueuedJob> {
    const [row] = await this.db
      .insert(t.jobs)
      .values({ workspaceId, kind, payload: payload as object, status: 'queued' })
      .returning({ id: t.jobs.id });
    const jobId = row!.id;
    this.notStarted.add(jobId);
    const calls: Promise<void>[] = [];

    const task = async () => {
      this.notStarted.delete(jobId);
      onStart();
      // close() already marked the row failed.
      if (this.closing) throw new Error(JOB_SHUTDOWN_ERROR);
      await this.db
        .update(t.jobs)
        .set({ status: 'running', startedAt: new Date() })
        .where(eq(t.jobs.id, jobId));
      try {
        await withRetry(
          () =>
            withTimeout(track(calls, handler(payload, { jobId })), this.timeoutMs).then(async () => {
              await this.db
                .update(t.jobs)
                .set({ attempts: 1 })
                .where(eq(t.jobs.id, jobId));
            }),
          {
            retries: this.retries,
            onRetry: async (attempt) => {
              await this.db
                .update(t.jobs)
                .set({ attempts: attempt })
                .where(eq(t.jobs.id, jobId));
            },
          },
        );
        await this.db
          .update(t.jobs)
          .set({ status: 'done', finishedAt: new Date() })
          .where(eq(t.jobs.id, jobId));
      } catch (err) {
        await this.db
          .update(t.jobs)
          .set({
            status: 'failed',
            finishedAt: new Date(),
            error: (err as Error).message,
          })
          .where(eq(t.jobs.id, jobId));
        throw err;
      }
    };

    // Behind the previous job for the same repo, if any; it enters the queue
    // (and takes a concurrency slot) only once that one has let go of the repo.
    const previous = repoId ? this.repoTails.get(repoId) : undefined;
    const done = (previous ? previous.then(() => this.queue.add(task)) : this.queue.add(task)) as Promise<void>;
    if (repoId) {
      const released = done.then(
        () => settled(calls, this.timeoutMs),
        () => settled(calls, this.timeoutMs),
      );
      this.repoTails.set(repoId, released);
      void released.then(() => {
        if (this.repoTails.get(repoId) === released) this.repoTails.delete(repoId);
      });
    }
    // The failure is already recorded in jobs.status/error, and callers that
    // want it can still await `done`. Most don't, and an unobserved rejection
    // ends the whole API process under Node's default policy.
    done.catch(() => undefined);

    return { id: jobId, done };
  }

  /** Wait for every job, including those still waiting for their repo (useful in tests). */
  async onIdle(): Promise<void> {
    while (this.repoTails.size > 0) await Promise.all(this.repoTails.values());
    await this.queue.onIdle();
  }

  /**
   * On shutdown: accept no more jobs, fail the ones that have not started (they
   * still pass through the queue, so their `done` settles), and give the
   * running ones up to `graceMs` to finish.
   */
  async close(graceMs: number): Promise<void> {
    this.closing = true;
    const dropped = [...this.notStarted];
    this.notStarted.clear();
    this.waiting.clear();
    if (dropped.length > 0) {
      await this.db
        .update(t.jobs)
        .set({ status: 'failed', finishedAt: new Date(), error: JOB_SHUTDOWN_ERROR })
        .where(inArray(t.jobs.id, dropped));
    }
    await settled([this.queue.onIdle()], graceMs);
  }

  /**
   * On boot: jobs a previous process left queued or running will never finish
   * (the queue lives in memory). Single-instance assumption, as for runs.
   */
  async reapStale(): Promise<number> {
    const rows = await this.db
      .update(t.jobs)
      .set({ status: 'failed', finishedAt: new Date(), error: JOB_RESTART_ERROR })
      .where(inArray(t.jobs.status, ['queued', 'running']))
      .returning({ id: t.jobs.id });
    return rows.length;
  }
}
