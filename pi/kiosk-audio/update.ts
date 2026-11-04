// The app's Update now: pull the playbook, then restart the kiosk if the pull asked for it, while the journal lines of both
// steps are sent to the app (through the WebSocket in update-socket.ts) as they are written. Each step follows its unit's
// journal with a journalctl child process, which is always stopped again: when the step ends, when the app goes away,
// after a time limit, and when this service stops.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';

/** What the app is sent, as JSON text frames. */
export type UpdateMessage =
  | { type: 'log' | 'error'; line: string }
  | { type: 'status'; state: 'pulling' | 'restarting' | 'done' | 'failed'; message?: string };

export type Send = (message: UpdateMessage) => void;

const JOURNALCTL = '/usr/bin/journalctl';
const SYSTEMCTL = '/usr/bin/systemctl';
/** Left by a pull that changed kiosk files (kiosk_restart_marker); kiosk-restart.service only runs when it exists. */
const RESTART_MARKER = '/run/kiosk/restart-needed';
/** journald hands a unit's last lines over a moment after the unit exits, so a follower is stopped a little later. */
const DRAIN_MS = 500;
const KILL_GRACE_MS = 2000;
/** kiosk-pull.service gives up after 30 minutes; this is a little more than that and its restart. */
const OVERALL_MS = 35 * 60 * 1000;

/** What an update needs from the machine; tests pass fakes. */
export interface UpdateIO {
  spawn: (file: string, args: string[]) => ChildProcess;
  markerExists: () => Promise<boolean>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const defaultIO: UpdateIO = {
  spawn: (file, args) =>
    // The callers pass the absolute paths above and fixed arguments: no shell, nothing from a request.
    spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', LC_ALL: 'C.UTF-8' } }),
  markerExists: async () => {
    try {
      await access(RESTART_MARKER);
      return true;
    } catch {
      return false;
    }
  },
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
function follow(io: UpdateIO, send: Send, unit: string, since: number) {
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

/** Runs a program to its end; resolves to its exit status (null when it could not run, or was killed). */
function run(io: UpdateIO, file: string, args: string[]): Promise<number | null> {
  return new Promise(resolve => {
    const child = io.spawn(file, args);
    child.on('error', () => {
      resolve(null);
    });
    child.on('exit', code => {
      resolve(code);
    });
  });
}

/**
 * Pulls, then restarts the kiosk when the pull asked for it. `send` gets the journal lines and the steps; `signal`
 * aborts the streaming (the app went away): a pull already started goes on by itself, and the kiosk then restarts at the
 * usual quiet time. The restart most likely ends the app's connection: it restarts the browser the app runs in.
 */
export async function runUpdate(send: Send, signal: AbortSignal, io: UpdateIO = defaultIO): Promise<void> {
  const stopped = AbortSignal.any([signal, AbortSignal.timeout(OVERALL_MS)]);
  let follower: ReturnType<typeof follow> | undefined;
  const isAborted = () => stopped.aborted;
  const onAbort = () => void follower?.stop(false);
  stopped.addEventListener('abort', onAbort);

  // Follows one unit's journal while `systemctl start` runs it to its end (they are Type=oneshot).
  const step = async (unit: string): Promise<number | null> => {
    follower = follow(io, send, unit, Math.floor(io.now() / 1000));
    const current = follower;
    const code = await run(io, SYSTEMCTL, ['start', unit]);
    await current.stop(!isAborted());
    return code;
  };

  try {
    send({ type: 'status', state: 'pulling' });
    const pulled = await step('kiosk-pull.service');
    if (isAborted()) return;
    if (pulled !== 0) {
      send({ type: 'status', state: 'failed', message: `The pull ended with status ${pulled ?? 'unknown'}.` });
      return;
    }
    if (!(await io.markerExists())) {
      send({ type: 'status', state: 'done', message: 'Nothing needed a restart.' });
      return;
    }
    send({ type: 'status', state: 'restarting' });
    const restarted = await step('kiosk-restart.service');
    if (isAborted()) return;
    send(
      restarted === 0
        ? { type: 'status', state: 'done', message: 'The kiosk restarted.' }
        : { type: 'status', state: 'failed', message: `The restart ended with status ${restarted ?? 'unknown'}.` }
    );
  } finally {
    stopped.removeEventListener('abort', onAbort);
    await follower?.stop(false);
  }
}
