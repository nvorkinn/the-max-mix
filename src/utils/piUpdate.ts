// The progress of the Pi's updates. The kiosk image serves what its updater (kiosk-pull) is doing on the loopback
// address (pi/kiosk-update-status); on the kiosk the app asks it every few seconds, and every second while an update
// runs, shows it in the settings and writes each step into the debug console.
import { debugLog } from './debugLog';
import { errorMessage } from './errorMessage';

/** kiosk_update_status_port in the Ansible role. A constant, like the kiosk-power:// links. */
export const UPDATE_STATUS_URL = 'http://127.0.0.1:7457/status';

const STATES = [
  'idle',
  'checking',
  'downloading',
  'installing',
  'up-to-date',
  'installed',
  'restart-needed',
  'failed'
] as const;
export type UpdateState = (typeof STATES)[number];

export interface UpdateStatus {
  state: UpdateState;
  /** The release tag (or pinned ref) being pulled, or '' before it is known. */
  ref: string;
  /** The commit the update ran from, or '' before the end. */
  commit: string;
  /** When the run started and when its status last changed, in ms since the epoch. */
  started: number;
  updated: number;
  /** The install step being run, and how many steps the last complete run had (0 when unknown). */
  step: number;
  total: number;
  detail: string;
}

const ACTIVE: ReadonlySet<UpdateState> = new Set(['checking', 'downloading', 'installing']);
/** kiosk-pull.service gives up after 30 minutes; an active status older than that belongs to a run that died. */
const STALE_MS = 35 * 60_000;

/** True while a run is under way. */
export function isActive(status: UpdateStatus | null, now = Date.now()): boolean {
  return status !== null && ACTIVE.has(status.state) && now - status.updated < STALE_MS;
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** The status from the service's JSON, or null when it is not one. */
export function parseUpdateStatus(body: unknown): UpdateStatus | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  const state = STATES.find(name => name === record['state']);
  if (!state) return null;
  return {
    state,
    ref: text(record['ref'], 100),
    commit: text(record['commit'], 40),
    started: count(record['started']) * 1000,
    updated: count(record['updated']) * 1000,
    step: count(record['step']),
    total: count(record['total']),
    detail: text(record['detail'], 200)
  };
}

/** Asks the Pi what its updater is doing. Throws when the service cannot be reached (an older kiosk image, or not a Pi). */
export async function fetchUpdateStatus(signal: AbortSignal | null = null): Promise<UpdateStatus> {
  const response = await fetch(UPDATE_STATUS_URL, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const status = parseUpdateStatus(await response.json());
  if (!status) throw new Error('Unexpected answer');
  return status;
}

/** How far the install is, from 0 to 1, or null when there is no install step or no total to compare with. */
export function installProgress(status: UpdateStatus): number | null {
  return status.state !== 'installing' || status.total === 0 ? null : Math.min(status.step / status.total, 0.99);
}

/** One sentence on what the updater is doing or last did, for the settings and the debug console. */
export function describeUpdate(status: UpdateStatus): string {
  const what = status.ref || 'the update';
  switch (status.state) {
    case 'idle': {
      return 'No update has run since the Pi started.';
    }
    case 'checking': {
      return 'Checking GitHub for the latest version…';
    }
    case 'downloading': {
      return `Downloading ${what}…`;
    }
    case 'installing': {
      const step =
        status.total > 0
          ? `step ${Math.min(status.step, status.total)} of about ${status.total}`
          : `step ${status.step}`;
      const task = status.detail ? ` (${status.detail})` : '';
      return `Installing ${what}: ${step}${task}…`;
    }
    case 'up-to-date': {
      return status.ref ? `Already up to date (${status.ref}).` : 'Already up to date.';
    }
    case 'installed': {
      return `Installed ${what}.`;
    }
    case 'restart-needed': {
      return `Installed ${what}. It applies when the kiosk restarts.`;
    }
    case 'failed': {
      return `Update failed: ${status.detail || 'no reason given.'}`;
    }
  }
}

export interface PiUpdate {
  /** The updater's latest status, or null before the first answer. */
  status: UpdateStatus | null;
  /** False when the Pi did not answer (an older kiosk image); null before the first try. */
  reachable: boolean | null;
  /** When Update now was last tapped (ms since the epoch), or null. */
  requestedAt: number | null;
  /** When the Pi was last asked (ms since the epoch), the time the rest is judged at. */
  checkedAt: number;
}

const FAST_MS = 1000;
const SLOW_MS = 10_000;
/** After a tap, ask quickly for this long even before the updater has started. */
const REQUEST_WINDOW_MS = 60_000;

const INITIAL: PiUpdate = { status: null, reachable: null, requestedAt: null, checkedAt: 0 };
let snapshot = INITIAL;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let watching = false;

function set(next: Partial<PiUpdate>): void {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

/** A line for the debug console when the run, its state or its step changed. */
function logChange(previous: UpdateStatus | null, next: UpdateStatus): void {
  if (
    previous?.started === next.started &&
    previous.state === next.state &&
    previous.step === next.step &&
    previous.ref === next.ref
  ) {
    return;
  }
  if (next.state === 'idle') return;
  const first = previous === null && !isActive(next);
  const when = new Date(next.updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const message = first ? `Last update run (${when}): ${describeUpdate(next)}` : describeUpdate(next);
  debugLog(next.state === 'failed' ? 'error' : 'info', 'update', message);
}

async function poll(): Promise<void> {
  try {
    const status = await fetchUpdateStatus();
    logChange(snapshot.status, status);
    set({ status, reachable: true, checkedAt: Date.now() });
  } catch (error) {
    // Once, not every few seconds: an older kiosk image has no status to show.
    if (snapshot.reachable !== false) {
      debugLog('warn', 'update', `Cannot see the Pi's update progress: ${errorMessage(error)}`);
    }
    set({ reachable: false, checkedAt: Date.now() });
  }
}

function schedule(): void {
  clearTimeout(timer);
  if (!watching) return;
  const now = Date.now();
  const fast =
    isActive(snapshot.status, now) || (snapshot.requestedAt !== null && now - snapshot.requestedAt < REQUEST_WINDOW_MS);
  timer = setTimeout(
    () => {
      void poll().then(schedule);
    },
    fast ? FAST_MS : SLOW_MS
  );
}

/** Starts asking the Pi about its updates (on the kiosk only). Safe to call more than once. */
export function watchPiUpdates(): void {
  if (watching) return;
  watching = true;
  void poll().then(schedule);
}

/** Stops asking and forgets everything (tests). */
export function stopWatchingPiUpdates(): void {
  watching = false;
  clearTimeout(timer);
  snapshot = INITIAL;
}

/** Records a tap on Update now, so the settings follow the run it starts and the Pi is asked every second. */
export function noteUpdateRequested(now = Date.now()): void {
  debugLog('info', 'update', 'Asked the Pi to update now');
  set({ requestedAt: now, checkedAt: now });
  if (watching) {
    void poll().then(schedule);
  }
}

export function getPiUpdate(): PiUpdate {
  return snapshot;
}

export function subscribePiUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
