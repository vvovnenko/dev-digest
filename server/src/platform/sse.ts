import { EventEmitter } from 'node:events';
import type { RunEvent, RunEventKind } from '@devdigest/shared';

/**
 * SSE / run-log bus.
 *
 * During a run, events are pushed to an in-memory buffer and emitted live to
 * any SSE subscriber on `/runs/:id/events`. On completion the full log is
 * persisted as ONE document in `run_traces` (done by the service layer, not here).
 *
 * Event shape on the wire (SSE `data`): RunEvent (see @devdigest/shared).
 */

/** Wall-clock time-of-day (HH:MM:SS, local) stamped on each log line. */
function clockTime(): string {
  return new Date().toTimeString().slice(0, 8);
}

/** How long a completed run's buffer stays in memory for late subscribers. */
const COMPLETED_RUN_TTL_MS = 5 * 60_000;

/** Why a run was told to stop: the user cancelled it, or the API is shutting down. */
export type RunStopReason = 'cancelled' | 'shutdown';

export class RunBus {
  private emitters = new Map<string, EventEmitter>();
  private buffers = new Map<string, RunEvent[]>();
  private seq = new Map<string, number>();
  private completed = new Set<string>();
  private cancelled = new Set<string>();
  /** Runs an executor in this process is working on, with the controller cancel() aborts. */
  private live = new Map<string, AbortController>();
  /** Runs an executor in this process has queued but not started (other agents go first). */
  private claimed = new Set<string>();
  private evictions = new Map<string, ReturnType<typeof setTimeout>>();
  private closing = false;
  private idleWaiters: Array<() => void> = [];

  constructor(private completedTtlMs = COMPLETED_RUN_TTL_MS) {}

  /**
   * Start a run in this process's executor. The returned signal aborts the
   * run's in-flight LLM call when cancel() or shutdown() is called; complete()
   * releases it. Tracking a run again returns the same signal.
   */
  track(runId: string): AbortSignal {
    this.claimed.delete(runId);
    const tracked = this.live.get(runId);
    if (tracked) return tracked.signal;
    const controller = new AbortController();
    this.live.set(runId, controller);
    if (this.stopReason(runId)) controller.abort();
    return controller.signal;
  }

  /** Queue runs for an executor in this process: shutdown waits for them too. */
  claim(runIds: string[]): void {
    for (const runId of runIds) this.claimed.add(runId);
  }

  /** Why the run must stop, if it must: a user's cancel wins over a shutdown. */
  stopReason(runId: string): RunStopReason | undefined {
    if (this.cancelled.has(runId)) return 'cancelled';
    return this.closing ? 'shutdown' : undefined;
  }

  /** Whether an executor in this process is working on the run now (false for a queued run, or an orphan after a restart). */
  isLive(runId: string): boolean {
    return this.live.has(runId);
  }

  /** Request cancellation of an in-flight run: aborts its current LLM call, and
   *  the runner also checks `stopReason` before each call and before saving. */
  cancel(runId: string): void {
    this.cancelled.add(runId);
    this.live.get(runId)?.abort();
  }

  /** Whether cancellation has been requested for a run. */
  isCancelled(runId: string): boolean {
    return this.cancelled.has(runId);
  }

  private emitterFor(runId: string): EventEmitter {
    let e = this.emitters.get(runId);
    if (!e) {
      e = new EventEmitter();
      e.setMaxListeners(50);
      this.emitters.set(runId, e);
      // Preserve any existing buffer/seq (e.g. a late subscriber after the run
      // completed must still be able to replay the buffered events).
      if (!this.buffers.has(runId)) this.buffers.set(runId, []);
      if (!this.seq.has(runId)) this.seq.set(runId, 0);
    }
    return e;
  }

  /** Publish a live event for a run. Returns the constructed RunEvent. */
  publish(runId: string, kind: RunEventKind, msg: string, data?: unknown): RunEvent {
    const e = this.emitterFor(runId);
    const next = (this.seq.get(runId) ?? 0) + 1;
    this.seq.set(runId, next);
    const event: RunEvent = { runId, seq: next, kind, msg, t: clockTime(), data };
    this.buffers.get(runId)!.push(event);
    e.emit('event', event);
    return event;
  }

  /** Subscribe to live events. Replays any buffered events first. */
  subscribe(runId: string, listener: (e: RunEvent) => void): () => void {
    const e = this.emitterFor(runId);
    for (const buffered of this.buffers.get(runId) ?? []) listener(buffered);
    e.on('event', listener);
    return () => e.off('event', listener);
  }

  /** The full buffered log for a run (used to persist the trace on completion). */
  buffer(runId: string): RunEvent[] {
    return this.buffers.get(runId) ?? [];
  }

  /** Signal completion and release the emitter; the buffer is evicted after a TTL. */
  complete(runId: string): void {
    const e = this.emitters.get(runId);
    this.completed.add(runId);
    this.live.delete(runId);
    this.claimed.delete(runId);
    if (this.isIdle()) for (const wake of this.idleWaiters.splice(0)) wake();
    e?.emit('done');
    // Keep the buffer briefly available for late subscribers; clear emitter.
    this.emitters.delete(runId);
    // Then drop it, or every run's full log stays in memory for the process's life.
    // A later subscriber reads the persisted trace instead (the SSE route does).
    clearTimeout(this.evictions.get(runId));
    const timer = setTimeout(() => this.evict(runId), this.completedTtlMs);
    timer.unref?.();
    this.evictions.set(runId, timer);
  }

  private isIdle(): boolean {
    return this.live.size === 0 && this.claimed.size === 0;
  }

  private evict(runId: string): void {
    // Kept until now so an executor that reaches a run cancelled while queued
    // skips it instead of paying for its LLM call.
    this.cancelled.delete(runId);
    // A late subscriber re-creates the emitter of a completed run; drop it too.
    this.emitters.delete(runId);
    this.buffers.delete(runId);
    this.seq.delete(runId);
    this.completed.delete(runId);
    this.evictions.delete(runId);
  }

  /** Whether this process knows the run at all (live, buffered or just completed). */
  isKnown(runId: string): boolean {
    return this.live.has(runId) || this.claimed.has(runId) || this.buffers.has(runId) || this.completed.has(runId);
  }

  /**
   * On shutdown: abort every live run (its executor records it as failed, not
   * cancelled, via stopReason) and end every open stream, so the server can close.
   */
  shutdown(): void {
    this.closing = true;
    for (const controller of this.live.values()) controller.abort();
    for (const [runId, e] of this.emitters) {
      this.completed.add(runId);
      e.emit('done');
    }
    this.emitters.clear();
    for (const timer of this.evictions.values()) clearTimeout(timer);
    this.evictions.clear();
  }

  /** Resolves once no run is live or queued (every executor has recorded its outcomes), or after `ms`. */
  async whenIdle(ms: number): Promise<void> {
    if (this.isIdle()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve);
      timer = setTimeout(resolve, ms);
      timer.unref?.();
    });
    clearTimeout(timer);
  }

  /** Whether a run has already completed (for replay-then-end late subscribers). */
  isComplete(runId: string): boolean {
    return this.completed.has(runId);
  }

  onDone(runId: string, listener: () => void): () => void {
    // A run that already completed fires immediately so late SSE subscribers,
    // after replaying the buffer, end the stream instead of hanging forever.
    if (this.completed.has(runId)) {
      queueMicrotask(listener);
      return () => undefined;
    }
    const e = this.emitterFor(runId);
    e.once('done', listener);
    return () => e.off('done', listener);
  }
}
