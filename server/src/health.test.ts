// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { HEALTH_WINDOW_MS, problem, waitForHealth } from './health.ts';
import type { HealthIO } from './health.ts';

function kiosk(overrides: Partial<HealthIO> = {}) {
  let now = 0;
  const io: HealthIO = {
    audio: () => Promise.resolve({ heartbeatAgeMs: 5000 }),
    isRunning: name => Promise.resolve(name === 'cage'),
    isChromiumRunning: () => Promise.resolve(true),
    now: () => now,
    sleep: ms => {
      now += ms;
      return Promise.resolve();
    },
    ...overrides
  };
  return { io, elapsed: () => now };
}

describe('problem', () => {
  it('needs kiosk-audio, Cage, Chromium and a recent heartbeat', async () => {
    await expect(problem(kiosk().io)).resolves.toBeNull();
    await expect(problem(kiosk({ audio: () => Promise.resolve(null) }).io)).resolves.toMatch(/kiosk-audio/);
    await expect(problem(kiosk({ isRunning: () => Promise.resolve(false) }).io)).resolves.toMatch(/Cage/);
    await expect(problem(kiosk({ isChromiumRunning: () => Promise.resolve(false) }).io)).resolves.toMatch(/Chromium/);
    const silent = kiosk({ audio: () => Promise.resolve({ heartbeatAgeMs: null }) }).io;
    await expect(problem(silent)).resolves.toMatch(/no heartbeat/);
    const stale = kiosk({ audio: () => Promise.resolve({ heartbeatAgeMs: 120_000 }) }).io;
    await expect(problem(stale)).resolves.toMatch(/stopped sending/);
  });
});

describe('waitForHealth', () => {
  it('waits for the app to come up', async () => {
    let beats = 0;
    const { io, elapsed } = kiosk({
      audio: () => Promise.resolve({ heartbeatAgeMs: (beats += 1) > 3 ? 1000 : null })
    });
    await expect(waitForHealth(io)).resolves.toBeNull();
    expect(elapsed()).toBe(15_000);
  });

  it('gives up after five minutes with what was still wrong', async () => {
    const { io, elapsed } = kiosk({ isChromiumRunning: () => Promise.resolve(false) });
    await expect(waitForHealth(io)).resolves.toBe('Chromium is not running.');
    expect(elapsed()).toBe(HEALTH_WINDOW_MS);
  });
});
