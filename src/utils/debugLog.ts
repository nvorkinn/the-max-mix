// A small in-memory log for the hidden debug console: the app's problems, together with the browser's own console errors
// and warnings, so they can be read on the kiosk itself.

export type DebugLevel = 'info' | 'warn' | 'error';

export interface DebugEntry {
  id: number;
  /** When the entry was first written (ms since the epoch). */
  time: number;
  /** When it was last repeated; equals `time` for a single entry. */
  lastTime: number;
  level: DebugLevel;
  /** Where it came from, such as "player" or "console". */
  source: string;
  message: string;
  /** How many times in a row the same message was written. */
  count: number;
}

/** The oldest entries are dropped beyond this, so a kiosk left running for weeks keeps a bounded log. */
export const MAX_ENTRIES = 200;

let entries: readonly DebugEntry[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Adds an entry. The same message repeated straight after itself (a failing poll) bumps a counter instead. */
export function debugLog(level: DebugLevel, source: string, message: string, now = Date.now()): void {
  const last = entries.at(-1);
  entries =
    last?.level === level && last.source === source && last.message === message
      ? [...entries.slice(0, -1), { ...last, count: last.count + 1, lastTime: now }]
      : [...entries, { id: nextId++, time: now, lastTime: now, level, source, message, count: 1 }].slice(-MAX_ENTRIES);
  emit();
}

/** The entries so far, oldest first. The same array is returned until something changes. */
export function getDebugEntries(): readonly DebugEntry[] {
  return entries;
}

export function clearDebugLog(): void {
  entries = [];
  emit();
}

/** Calls `listener` after every change; returns the function that stops it. */
export function subscribeDebugLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function describe(value: unknown): string {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return value === undefined ? 'undefined' : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

let captured = false;

/**
 * Copies console errors and warnings, uncaught errors and unhandled promise rejections into the log. The console
 * itself keeps working as before. Safe to call more than once.
 */
export function captureBrowserErrors(): void {
  if (captured) return;
  captured = true;
  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      debugLog(level, 'console', args.map(arg => describe(arg)).join(' '));
    };
  }
  window.addEventListener('error', event => {
    debugLog('error', 'page', event.error ? describe(event.error) : event.message);
  });
  window.addEventListener('unhandledrejection', event => {
    debugLog('error', 'promise', describe(event.reason));
  });
}
