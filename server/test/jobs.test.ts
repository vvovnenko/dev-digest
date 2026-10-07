import { describe, it, expect, afterEach } from 'vitest';
import type { Db } from '../src/db/client.js';
import { JOB_SHUTDOWN_ERROR, JobRunner } from '../src/platform/jobs.js';

/** Just enough of Drizzle for JobRunner: numbered inserted rows, every update recorded. */
function fakeDb() {
  const updates: Record<string, unknown>[] = [];
  let inserted = 0;
  const db = {
    insert: () => ({ values: () => ({ returning: async () => [{ id: `job-${++inserted}` }] }) }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push(values);
        },
      }),
    }),
  };
  return { db: db as unknown as Db, updates };
}

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  unhandled.length = 0;
});

describe('JobRunner failures', () => {
  it('records a failed job without an unhandled rejection (which would end the API process)', async () => {
    process.on('unhandledRejection', onUnhandled);
    const { db, updates } = fakeDb();
    const runner = new JobRunner(db, { retries: 0 });
    runner.register('clone', async () => {
      throw new Error('repository not found');
    });

    await runner.enqueue('ws-1', 'clone', {}); // fire-and-forget, as every caller does
    await runner.onIdle();
    await new Promise((resolve) => setImmediate(resolve)); // let rejection tracking run

    expect(updates.at(-1)).toMatchObject({ status: 'failed', error: 'repository not found' });
    expect(unhandled).toEqual([]);
  });

  it('still rejects `done` for a caller that awaits it', async () => {
    const { db } = fakeDb();
    const runner = new JobRunner(db, { retries: 0 });
    runner.register('clone', async () => {
      throw new Error('repository not found');
    });

    const job = await runner.enqueue('ws-1', 'clone', {});
    await expect(job.done).rejects.toThrow('repository not found');
  });
});

/** A handler whose calls the test finishes by hand (by `tag`), logging start and end. */
function manualHandler(log: string[]) {
  const finish = new Map<string, () => void>();
  const handler = (payload: unknown) =>
    new Promise<void>((resolve) => {
      const { tag } = payload as { tag: string };
      log.push(`start ${tag}`);
      finish.set(tag, () => {
        log.push(`end ${tag}`);
        resolve();
      });
    });
  return { handler, finish: (tag: string) => finish.get(tag)!() };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('JobRunner per-repo lock', () => {
  it('runs jobs for one repo one at a time, whatever their kind, and other repos alongside', async () => {
    const log: string[] = [];
    const { handler, finish } = manualHandler(log);
    const runner = new JobRunner(fakeDb().db, { retries: 0 });
    runner.register('clone', handler);
    runner.register('index', handler);

    await runner.enqueue('ws', 'clone', { repoId: 'a', tag: 'a-clone' });
    await runner.enqueue('ws', 'index', { repoId: 'a', tag: 'a-index' });
    await runner.enqueue('ws', 'clone', { repoId: 'b', tag: 'b-clone' });
    await flush();
    expect(log).toEqual(['start a-clone', 'start b-clone']);

    finish('a-clone');
    await flush();
    expect(log).toEqual(['start a-clone', 'start b-clone', 'end a-clone', 'start a-index']);
    finish('a-index');
    finish('b-clone');
    await runner.onIdle();
  });

  it('joins a repeat request to the job still waiting, but queues one after it has started', async () => {
    const log: string[] = [];
    const { handler, finish } = manualHandler(log);
    const runner = new JobRunner(fakeDb().db, { retries: 0 });
    runner.register('index', handler);

    const running = await runner.enqueue('ws', 'index', { repoId: 'a', tag: 'first' });
    const [second, repeat] = await Promise.all([
      runner.enqueue('ws', 'index', { repoId: 'a', tag: 'second' }),
      runner.enqueue('ws', 'index', { repoId: 'a', tag: 'second-again' }),
    ]);
    expect(second.id).not.toBe(running.id);
    expect(repeat.id).toBe(second.id);

    finish('first');
    await flush();
    const third = await runner.enqueue('ws', 'index', { repoId: 'a', tag: 'third' });
    expect(third.id).not.toBe(second.id);
    finish('second');
    await flush();
    finish('third');
    await runner.onIdle();
    expect(log.filter((l) => l.startsWith('start'))).toEqual(['start first', 'start second', 'start third']);
  });

  it('keeps the repo until a timed-out handler has actually stopped', async () => {
    const log: string[] = [];
    const { handler, finish } = manualHandler(log);
    const runner = new JobRunner(fakeDb().db, { retries: 0, timeoutMs: 20 });
    runner.register('index', handler);

    const slow = await runner.enqueue('ws', 'index', { repoId: 'a', tag: 'slow' });
    await runner.enqueue('ws', 'index', { repoId: 'a', tag: 'next' });
    await expect(slow.done).rejects.toThrow(/timed out/);
    await flush();
    expect(log).toEqual(['start slow']); // the abandoned handler is still writing

    finish('slow');
    await flush();
    expect(log).toEqual(['start slow', 'end slow', 'start next']);
    finish('next');
    await runner.onIdle();
  });
});

describe('JobRunner.close', () => {
  it('fails the jobs that have not started, lets the running one finish, and refuses new ones', async () => {
    const log: string[] = [];
    const { handler, finish } = manualHandler(log);
    const { db, updates } = fakeDb();
    const runner = new JobRunner(db, { retries: 0 });
    runner.register('index', handler);

    const running = await runner.enqueue('ws', 'index', { repoId: 'a', tag: 'running' });
    const behind = await runner.enqueue('ws', 'index', { repoId: 'a', tag: 'behind' });
    await flush();

    const closed = runner.close(1_000);
    await flush();
    expect(updates).toContainEqual(expect.objectContaining({ status: 'failed', error: JOB_SHUTDOWN_ERROR }));
    await expect(runner.enqueue('ws', 'index', { repoId: 'b', tag: 'late' })).rejects.toThrow(/shutting down/);

    finish('running');
    await closed;
    await expect(running.done).resolves.toBeUndefined();
    await expect(behind.done).rejects.toThrow(JOB_SHUTDOWN_ERROR);
    expect(log).toEqual(['start running', 'end running']);
  });
});
