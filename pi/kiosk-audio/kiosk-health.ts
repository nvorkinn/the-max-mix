// kiosk-health.service, run as root once each boot: settles a tried update (image-update.ts afterBoot), then gives the
// kiosk five minutes to come up (health.ts). Healthy: `rauc status mark-good`, which on a new slot's first boot makes
// it the slot every boot starts. Not healthy on that first boot: mark it bad and reboot into the old slot.
import { readdir, readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { waitForHealth } from './health.ts';
import { updateIO } from './image-update-io.ts';
import { afterBoot, giveUp, keep } from './image-update.ts';
import { raucOverDbus } from './rauc.ts';
import { chromiumPid } from './watchdog.ts';

const AUDIO_HEALTH = 'http://127.0.0.1:7341/health';

async function audio(): Promise<{ heartbeatAgeMs: number | null } | null> {
  try {
    const response = await fetch(AUDIO_HEALTH, { signal: AbortSignal.timeout(3000) });
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

const rauc = await raucOverDbus();
const io = updateIO(rauc);
try {
  const boot = await afterBoot(io);
  const wrong = await waitForHealth({
    audio,
    isRunning,
    isChromiumRunning: async () => (await chromiumPid()) !== null,
    now: () => Date.now(),
    sleep: ms => sleep(ms)
  });
  if (wrong === null) await keep(io, boot);
  else await giveUp(io, boot, wrong);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await rauc.close();
}
