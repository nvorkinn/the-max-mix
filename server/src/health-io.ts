// The real Pi behind health.ts's HealthIO, for kiosk-health.ts (after a boot) and kiosk-update.ts (after changing over
// to a newer app with no reboot).
import { readdir, readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import type { HealthIO } from './health.ts';
import { chromiumPid, monotonicNow } from './watchdog.ts';

const SERVER_HEALTH = 'http://127.0.0.1:7341/health';

async function server(): Promise<{ heartbeatAgeMs: number | null } | null> {
  try {
    const response = await fetch(SERVER_HEALTH, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const body = (await response.json()) as { heartbeatAgeMs?: unknown };
    return { heartbeatAgeMs: typeof body.heartbeatAgeMs === 'number' ? body.heartbeatAgeMs : null };
  } catch {
    return null;
  }
}

async function isRunning(name: string): Promise<boolean> {
  const entries = await readdir('/proc');
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      // One small read per process, in turn.
      // eslint-disable-next-line no-await-in-loop
      if ((await readFile(`/proc/${entry}/comm`, 'utf8')).trim() === name) return true;
    } catch {
      // It ended while we looked.
    }
  }
  return false;
}

export const healthIO: HealthIO = {
  server,
  isRunning,
  isChromiumRunning: async () => (await chromiumPid()) !== null,
  now: monotonicNow,
  sleep: ms => sleep(ms)
};
