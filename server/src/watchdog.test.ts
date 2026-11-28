// @vitest-environment node
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { chromiumPid, MAX_STALE_MS, monotonicNow, STALE_MS, Watchdog } from './watchdog.ts';

function setup() {
  const state = { now: 0, pid: 100 as number | null, stopped: [] as number[], logs: [] as string[] };
  const watchdog = new Watchdog({
    now: () => state.now,
    chromiumPid: () => Promise.resolve(state.pid),
    stop: stopped => {
      state.stopped.push(stopped);
      state.pid = null;
      return Promise.resolve();
    },
    log: message => {
      state.logs.push(message);
    }
  });
  return { state, watchdog };
}

describe('Watchdog', () => {
  it('leaves Chromium alone until the app has sent a heartbeat', async () => {
    const { state, watchdog } = setup();
    await watchdog.check();
    state.now = 10 * STALE_MS;
    expect(await watchdog.check()).toBe(false);
    expect(state.stopped).toEqual([]);
  });

  it('restarts Chromium when the heartbeats stop', async () => {
    const { state, watchdog } = setup();
    await watchdog.check();
    watchdog.beat();
    state.now = STALE_MS - 1;
    expect(await watchdog.check()).toBe(false);
    state.now = STALE_MS;
    expect(await watchdog.check()).toBe(true);
    expect(state.stopped).toEqual([100]);
    expect(state.logs[0]).toMatch(/No heartbeat/);
  });

  it('waits for an app that said it is away, and restarts one that never comes back', async () => {
    const { state, watchdog } = setup();
    watchdog.beat();
    await watchdog.check();
    watchdog.away(10 * 60_000);
    state.now = 10 * 60_000 + STALE_MS - 1;
    expect(await watchdog.check()).toBe(false);
    state.now = 10 * 60_000 + STALE_MS;
    expect(await watchdog.check()).toBe(true);
    expect(state.stopped).toEqual([100]);
  });

  it('gives a new Chromium the whole wait, and leaves a stopped one alone', async () => {
    const { state, watchdog } = setup();
    await watchdog.check();
    watchdog.beat();
    state.now = STALE_MS - 1000;
    state.pid = 200;
    await watchdog.check();
    state.now = 2 * STALE_MS - 1001;
    expect(await watchdog.check()).toBe(false);
    state.pid = null;
    await watchdog.check();
    state.now = 10 * STALE_MS;
    expect(await watchdog.check()).toBe(false);
    expect(state.stopped).toEqual([]);
  });

  it('waits twice as long after each restart without a heartbeat, up to a cap, and resets on a heartbeat', async () => {
    const { state, watchdog } = setup();
    await watchdog.check();
    watchdog.beat();
    const waits = [STALE_MS, 2 * STALE_MS, 4 * STALE_MS, 8 * STALE_MS, 16 * STALE_MS, MAX_STALE_MS];
    // Each restart depends on the one before it, so the steps run one after another.
    for (const [i, wait] of waits.entries()) {
      state.pid = 100 + i;
      // eslint-disable-next-line no-await-in-loop
      await watchdog.check();
      const start = state.now;
      state.now = start + wait - 1;
      // eslint-disable-next-line no-await-in-loop
      expect(await watchdog.check()).toBe(false);
      state.now = start + wait;
      // eslint-disable-next-line no-await-in-loop
      expect(await watchdog.check()).toBe(true);
    }
    watchdog.beat();
    expect(watchdog.limit).toBe(STALE_MS);
  });
});

describe('chromiumPid', () => {
  it('reads a running process from the pid file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'watchdog-'));
    const file = path.join(dir, 'chromium.pid');
    expect(await chromiumPid(file)).toBeNull();
    await writeFile(file, `${process.pid}\n`);
    expect(await chromiumPid(file)).toBe(process.pid);
    await writeFile(file, 'nonsense');
    expect(await chromiumPid(file)).toBeNull();
  });
});

describe('monotonicNow', () => {
  it('ignores the wall clock jumping, as it does when NTP first syncs on a Pi without a real-time clock', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-24T22:00:00Z'));
      const before = monotonicNow();
      vi.setSystemTime(new Date('2026-11-24T22:28:00Z'));
      expect(monotonicNow() - before).toBeLessThan(STALE_MS);
    } finally {
      vi.useRealTimers();
    }
  });
});
