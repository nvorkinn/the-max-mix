// Whether the kiosk came up properly after a boot, for kiosk-health.ts: kiosk-audio answers, Cage and Chromium run, and
// the app has sent a heartbeat lately (the same signal the page watchdog follows, watchdog.ts). None of it needs the
// internet, since a friend's Wi-Fi may be down when an update first starts.

/** How long a new slot has to show it works. */
export const HEALTH_WINDOW_MS = 5 * 60_000;
const POLL_MS = 5000;
/** The app beats every 20 s. */
const FRESH_MS = 60_000;

export interface HealthIO {
  /** kiosk-audio's GET /health: how long ago the app last sent a heartbeat (null: never); null when it does not answer. */
  audio: () => Promise<{ heartbeatAgeMs: number | null } | null>;
  /** Whether a process with this name (/proc/<pid>/comm) runs. */
  isRunning: (name: string) => Promise<boolean>;
  /** Whether the Chromium kiosk-session started runs. */
  isChromiumRunning: () => Promise<boolean>;
  /** A monotonic clock: the clock jumps when NTP first syncs, often inside the health window. */
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

/** What is wrong now, or null when everything is up. */
export async function problem(io: HealthIO): Promise<string | null> {
  const audio = await io.audio();
  if (!audio) return 'kiosk-audio does not answer.';
  if (!(await io.isRunning('cage'))) return 'Cage is not running.';
  if (!(await io.isChromiumRunning())) return 'Chromium is not running.';
  if (audio.heartbeatAgeMs === null) return 'The app has sent no heartbeat.';
  if (audio.heartbeatAgeMs > FRESH_MS) return 'The app has stopped sending heartbeats.';
  return null;
}

/** Waits until everything is up; resolves null when it is, or what was still wrong when the time ran out. */
export async function waitForHealth(io: HealthIO, windowMs = HEALTH_WINDOW_MS): Promise<string | null> {
  const deadline = io.now() + windowMs;
  for (;;) {
    // One look at a time, a few seconds apart.
    // eslint-disable-next-line no-await-in-loop
    const wrong = await problem(io);
    if (wrong === null) return null;
    if (io.now() >= deadline) return wrong;
    // eslint-disable-next-line no-await-in-loop
    await io.sleep(POLL_MS);
  }
}
