// Restarts Chromium when the app stops answering: a crashed tab, a page that hangs, or an app that went blank. The app
// (?kiosk=1) sends POST /heartbeat every 20 seconds while it shows something; when none has come for a while, Chromium is
// stopped and kiosk-session's loop starts it again (or shows the Wi-Fi setup page when there is no connection). The setup
// page sends heartbeats too.
//
// It never fights the kiosk's own restarts: it only acts once this service has had a heartbeat (so an app from before the
// watchdog is left alone), and every new Chromium gets the full wait from its start. A restart of the kiosk (an update,
// the Restart button, 04:30) restarts this service too, which disarms it.
// Each restart without a heartbeat in between doubles the wait, so a page that cannot load is not restarted in a loop.
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

/** The app sends one every 20 s; hidden pages may be throttled to once a minute, so allow a few to be missed. */
export const STALE_MS = 3 * 60_000;
export const MAX_STALE_MS = 60 * 60_000;
export const CHECK_MS = 15_000;
const STOP_WAIT_MS = 10_000;
const CHROMIUM_PID = '/run/kiosk/chromium.pid';

export interface WatchdogDeps {
  now: () => number;
  /** The running Chromium's process id, or null when it is not running. */
  chromiumPid: () => Promise<number | null>;
  /** Stops that Chromium. */
  stop: (pid: number) => Promise<void>;
  log: (message: string) => void;
}

export class Watchdog {
  readonly #deps: WatchdogDeps;
  #armed = false;
  #lastBeat = 0;
  #pid: number | null = null;
  #restarts = 0;

  constructor(deps: WatchdogDeps) {
    this.#deps = deps;
  }

  /** The app is alive. */
  beat(): void {
    this.#armed = true;
    this.#lastBeat = this.#deps.now();
    this.#restarts = 0;
  }

  /** How long the current Chromium may go without a heartbeat. */
  get limit(): number {
    return Math.min(STALE_MS * 2 ** this.#restarts, MAX_STALE_MS);
  }

  /** Stops Chromium when its page has been silent for too long. Returns true when it did. */
  async check(): Promise<boolean> {
    const pid = await this.#deps.chromiumPid();
    if (pid !== this.#pid) {
      // A new Chromium (or none, between two): its page gets the whole wait to load.
      this.#pid = pid;
      this.#lastBeat = this.#deps.now();
      return false;
    }
    const silent = this.#deps.now() - this.#lastBeat;
    if (pid === null || !this.#armed || silent < this.limit) return false;
    this.#deps.log(`No heartbeat from the app for ${Math.round(silent / 1000)} s: restarting Chromium`);
    this.#restarts += 1;
    this.#lastBeat = this.#deps.now();
    await this.#deps.stop(pid);
    return true;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Chromium's process id from kiosk-session's pid file, when that process still runs. */
export async function chromiumPid(file = CHROMIUM_PID): Promise<number | null> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return null;
  }
  const pid = Number(text.trim());
  return Number.isSafeInteger(pid) && pid > 1 && isAlive(pid) ? pid : null;
}

/** SIGTERM, then SIGKILL if Chromium is still there after a few seconds (a hung browser may not quit on its own). */
export async function stopChromium(pid: number, waitMs = STOP_WAIT_MS): Promise<void> {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
  await sleep(waitMs);
  if (!isAlive(pid)) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // It quit just now.
  }
}
