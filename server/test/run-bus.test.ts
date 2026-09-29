import { describe, it, expect } from 'vitest';
import { RunBus } from '../src/platform/sse.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('RunBus', () => {
  it('cancel aborts the signal of the run it tracks, even when cancelled first', () => {
    const bus = new RunBus();
    const signal = bus.track('r1');
    bus.cancel('r1');
    expect(signal.aborted).toBe(true);

    bus.cancel('r2');
    expect(bus.track('r2').aborted).toBe(true);
  });

  it('a late subscriber gets the buffered log and then done, until the buffer is evicted', async () => {
    const bus = new RunBus(30);
    bus.track('r1');
    bus.publish('r1', 'info', 'start');
    bus.publish('r1', 'result', 'end');
    bus.complete('r1');
    expect(bus.isLive('r1')).toBe(false);

    const seen: string[] = [];
    bus.subscribe('r1', (e) => seen.push(e.msg));
    let done = false;
    bus.onDone('r1', () => (done = true));
    await tick();
    expect(seen).toEqual(['start', 'end']);
    expect(done).toBe(true);

    await tick(60);
    expect(bus.isKnown('r1')).toBe(false);
    expect(bus.buffer('r1')).toEqual([]);
  });

  it('shutdown aborts live runs and ends open streams', () => {
    const bus = new RunBus();
    const signal = bus.track('r1');
    let done = false;
    bus.onDone('r1', () => (done = true));
    bus.shutdown();
    expect(signal.aborted).toBe(true);
    expect(done).toBe(true);
  });
  it('a run cancelled while queued stays cancelled when its executor gets to it', () => {
    const bus = new RunBus();
    bus.claim(['r1']);
    expect(bus.isLive('r1')).toBe(false);
    bus.cancel('r1');
    bus.complete('r1'); // what cancelRun does for a run nobody works on yet
    expect(bus.track('r1').aborted).toBe(true);
    expect(bus.stopReason('r1')).toBe('cancelled');
  });

  it('whenIdle waits for started and queued runs, and a shutdown is not a cancel', async () => {
    const bus = new RunBus();
    bus.claim(['r1', 'r2']);
    const signal = bus.track('r1');
    bus.shutdown();
    expect(signal.aborted).toBe(true);
    expect(bus.stopReason('r1')).toBe('shutdown');
    expect(bus.isCancelled('r1')).toBe(false);

    let idle = false;
    const waiting = bus.whenIdle(1_000).then(() => (idle = true));
    bus.complete('r1');
    await tick();
    expect(idle).toBe(false); // r2 is still queued
    expect(bus.track('r2').aborted).toBe(true);
    bus.complete('r2');
    await waiting;
    expect(idle).toBe(true);
  });
});
