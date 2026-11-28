// The app's Install: run kiosk-update.service, the timer's own path, while its journal lines, RAUC's progress among them,
// are sent to the app (through the WebSocket in update-socket.ts) as they are written. The journal is followed with a
// journalctl child process, which is always stopped again: when the unit ends, when the app goes away, after a time
// limit, and when this service stops.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { RESTART_LINE } from './image-update.ts';

/** What the app is sent, as JSON text frames. */
export type UpdateMessage =
  | { type: 'log' | 'error'; line: string }
  | {
      type: 'status';
      state: 'installing' | 'installed' | 'restarting' | 'done' | 'failed';
      message?: string;
    };

export type Send = (message: UpdateMessage) => void;

const JOURNALCTL = '/usr/bin/journalctl';
const SYSTEMCTL = '/usr/bin/systemctl';
/** journald hands a unit's last lines over a moment after the unit exits, so a follower is stopped a little later. */
const DRAIN_MS = 500;
const KILL_GRACE_MS = 2000;
/** Longer than a whole bundle takes to stream in on a slow connection. */
const OVERALL_MS = 35 * 60 * 1000;

/** What an update needs from the machine; tests pass fakes. */
export interface UpdateIO {
  spawn: (file: string, args: string[]) => ChildProcess;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const defaultIO: UpdateIO = {
  spawn: (file, args) =>
    // The callers pass the absolute paths above and fixed arguments: no shell, nothing from a request.
    spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', LC_ALL: 'C.UTF-8' } }),
  now: () => Date.now(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms))
};

// Every journalctl this service has running, so that they can all be stopped when it ends.
const live = new Set<ChildProcess>();

/** Stops every journalctl still running. Safe in a process 'exit' handler: it only signals. */
export function stopFollowers(): void {
  for (const child of live) child.kill('SIGKILL');
  live.clear();
}

/** Turns chunks of output into whole lines. */
function lineBuffer(emit: (line: string) => void) {
  let rest = '';
  return {
    push(chunk: Buffer | string) {
      rest += chunk.toString();
      const lines = rest.split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) if (line.trim() !== '') emit(line);
    },
    flush() {
      if (rest.trim() !== '') emit(rest);
      rest = '';
    }
  };
}

/** Starts a journalctl that follows `unit` from `since` (epoch seconds, so lines written before it started are kept). */
function follow(io: UpdateIO, send: Send, unit: string, since: number, onLine?: (line: string) => void) {
  const child = io.spawn(JOURNALCTL, [
    '--unit',
    unit,
    '--follow',
    `--since=@${since}`,
    '--output',
    'short-iso',
    '--no-hostname',
    '--no-pager'
  ]);
  live.add(child);
  const lines = lineBuffer(line => {
    send({ type: 'log', line });
    onLine?.(line);
  });
  const problems = lineBuffer(line => {
    send({ type: 'error', line });
  });
  child.stdout?.on('data', (chunk: Buffer) => {
    lines.push(chunk);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    problems.push(chunk);
  });
  let isExited = false;
  const gone = new Promise<void>(resolve => {
    const done = () => {
      isExited = true;
      live.delete(child);
      resolve();
    };
    child.on('exit', done);
    child.on('error', (error: Error) => {
      send({ type: 'error', line: `journalctl: ${error.message}` });
      done();
    });
  });
  return {
    /** Stops the follower; `shouldDrain` waits a moment first for the last lines. Resolves once it has exited. */
    async stop(shouldDrain: boolean) {
      if (shouldDrain) await io.sleep(DRAIN_MS);
      if (!isExited) {
        child.kill('SIGTERM');
        const hard = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
        await gone;
        clearTimeout(hard);
      }
      lines.flush();
      problems.flush();
    }
  };
}

/** Runs systemctl to its end; resolves to its exit status (null when it could not run, or was killed). */
function systemctl(io: UpdateIO, args: string[]): Promise<number | null> {
  return new Promise(resolve => {
    const child = io.spawn(SYSTEMCTL, args);
    child.on('error', () => {
      resolve(null);
    });
    child.on('exit', code => {
      resolve(code);
    });
  });
}

/**
 * Runs kiosk-update.service (check, then install anything newer, as the timer does) while its journal goes to the app,
 * RAUC's progress lines among them. The unit restarts the Pi into what it installed at once, which ends the connection;
 * `installed` says what still waits for a restart when that did not happen. `signal` aborts the streaming (the app
 * went away): the unit goes on by itself.
 */
export async function runUpdate(
  send: Send,
  signal: AbortSignal,
  installed: () => Promise<string | null>,
  io: UpdateIO = defaultIO
): Promise<void> {
  const stopped = AbortSignal.any([signal, AbortSignal.timeout(OVERALL_MS)]);
  // Set by the follower's callback, so kept in an object TypeScript does not narrow.
  const seen = { isRestarting: false };
  const follower = follow(io, send, 'kiosk-update.service', Math.floor(io.now() / 1000), line => {
    if (seen.isRestarting || !line.includes(RESTART_LINE)) return;
    seen.isRestarting = true;
    send({ type: 'status', state: 'restarting' });
  });
  const onAbort = () => void follower.stop(false);
  stopped.addEventListener('abort', onAbort);
  try {
    send({ type: 'status', state: 'installing' });
    const code = await systemctl(io, ['start', 'kiosk-update.service']);
    await follower.stop(!stopped.aborted);
    if (seen.isRestarting || stopped.aborted) return;
    if (code !== 0) {
      send({ type: 'status', state: 'failed', message: `The update ended with status ${code ?? 'unknown'}.` });
      return;
    }
    const version = await installed();
    send(
      version === null ? { type: 'status', state: 'done' } : { type: 'status', state: 'installed', message: version }
    );
  } finally {
    stopped.removeEventListener('abort', onAbort);
    await follower.stop(false);
  }
}
