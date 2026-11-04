// @vitest-environment node
/* eslint-disable unicorn/prefer-event-target -- A child process is an EventEmitter, so the stand-in is one. */
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runUpdate, stopFollowers } from './update.ts';
import type { UpdateIO, UpdateMessage } from './update.ts';

/** A stand-in for a child process: the test decides what it prints and when it exits. */
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed: string[] = [];
  kill(signal: string) {
    this.killed.push(signal);
    // journalctl exits when it is signalled.
    queueMicrotask(() => this.emit('exit', null, signal));
    return true;
  }
  print(text: string) {
    this.stdout.emit('data', Buffer.from(text));
  }
  exit(code: number) {
    this.emit('exit', code, null);
  }
}

interface Spawned {
  file: string;
  args: string[];
  child: FakeChild;
}

const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(options: { marker?: boolean } = {}) {
  const spawned: Spawned[] = [];
  const order: string[] = [];
  const io: UpdateIO = {
    spawn: (file, args) => {
      const child = new FakeChild();
      spawned.push({ file, args, child });
      order.push(`${file.split('/').at(-1)} ${args.join(' ')}`.trim());
      return child as unknown as ChildProcess;
    },
    markerExists: () => Promise.resolve(options.marker ?? false),
    now: () => 1_700_000_000_500,
    sleep: () => Promise.resolve()
  };
  const messages: UpdateMessage[] = [];
  const send = (message: UpdateMessage) => {
    messages.push(message);
  };
  const journalFor = (unit: string) => spawned.find(s => s.file.endsWith('journalctl') && s.args.includes(unit));
  const systemctlFor = (unit: string) => spawned.find(s => s.file.endsWith('systemctl') && s.args.includes(unit));
  return { io, spawned, order, messages, send, journalFor, systemctlFor };
}

afterEach(() => {
  stopFollowers();
});

describe('runUpdate', () => {
  it('follows the pull before starting it, sends its lines whole, and is done when no restart is needed', async () => {
    const h = harness({ marker: false });
    const finished = runUpdate(h.send, new AbortController().signal, h.io);
    await tick();

    // The follower is first, from the second before the start, so no line is missed.
    expect(h.order[0]).toBe(
      'journalctl --unit kiosk-pull.service --follow --since=@1700000000 --output short-iso --no-hostname --no-pager'
    );
    expect(h.order[1]).toBe('systemctl start kiosk-pull.service');
    const journal = h.journalFor('kiosk-pull.service')?.child;
    journal?.print('2026-11-04T20:00:00+0000 kiosk-pull[1]: first\n2026-11-04T20:00:01+0000 kiosk-pull[1]: sec');
    journal?.print('ond\n');
    h.systemctlFor('kiosk-pull.service')?.child.exit(0);
    await finished;

    expect(h.messages).toEqual([
      { type: 'status', state: 'pulling' },
      { type: 'log', line: '2026-11-04T20:00:00+0000 kiosk-pull[1]: first' },
      { type: 'log', line: '2026-11-04T20:00:01+0000 kiosk-pull[1]: second' },
      { type: 'status', state: 'done', message: 'Nothing needed a restart.' }
    ]);
    // The follower was stopped, and no restart was started.
    expect(journal?.killed).toEqual(['SIGTERM']);
    expect(h.systemctlFor('kiosk-restart.service')).toBeUndefined();
  });

  it('restarts the kiosk when the pull left the marker, following the restart too', async () => {
    const h = harness({ marker: true });
    const finished = runUpdate(h.send, new AbortController().signal, h.io);
    await tick();
    h.systemctlFor('kiosk-pull.service')?.child.exit(0);
    await tick();
    await tick();

    expect(h.messages.map(message => message.type === 'status' && message.state)).toContain('restarting');
    const restartJournal = h.journalFor('kiosk-restart.service');
    expect(restartJournal).toBeDefined();
    // Its follower started before the restart itself.
    expect(h.order.indexOf(`journalctl ${restartJournal?.args.join(' ')}`)).toBeLessThan(
      h.order.indexOf('systemctl start kiosk-restart.service')
    );
    restartJournal?.child.print('2026-11-04T20:01:00+0000 systemd[1]: Starting kiosk-restart.service\n');
    h.systemctlFor('kiosk-restart.service')?.child.exit(0);
    await finished;

    expect(h.messages.at(-1)).toEqual({ type: 'status', state: 'done', message: 'The kiosk restarted.' });
    expect(h.messages).toContainEqual({
      type: 'log',
      line: '2026-11-04T20:01:00+0000 systemd[1]: Starting kiosk-restart.service'
    });
    // Both followers are gone.
    const followers = h.spawned.filter(s => s.file.endsWith('journalctl'));
    expect(followers.map(s => s.child.killed)).toEqual([['SIGTERM'], ['SIGTERM']]);
  });

  it('stops after a failed pull, without a restart', async () => {
    const h = harness({ marker: true });
    const finished = runUpdate(h.send, new AbortController().signal, h.io);
    await tick();
    h.systemctlFor('kiosk-pull.service')?.child.exit(1);
    await finished;
    expect(h.messages.at(-1)).toEqual({ type: 'status', state: 'failed', message: 'The pull ended with status 1.' });
    expect(h.systemctlFor('kiosk-restart.service')).toBeUndefined();
    expect(h.journalFor('kiosk-pull.service')?.child.killed).toEqual(['SIGTERM']);
  });

  it('says so when a step cannot run at all, and when it fails to restart', async () => {
    const h = harness();
    const finished = runUpdate(h.send, new AbortController().signal, h.io);
    await tick();
    h.systemctlFor('kiosk-pull.service')?.child.emit('error', new Error('spawn ENOENT'));
    await finished;
    expect(h.messages.at(-1)).toEqual({
      type: 'status',
      state: 'failed',
      message: 'The pull ended with status unknown.'
    });

    const r = harness({ marker: true });
    const second = runUpdate(r.send, new AbortController().signal, r.io);
    await tick();
    r.systemctlFor('kiosk-pull.service')?.child.exit(0);
    await tick();
    await tick();
    r.systemctlFor('kiosk-restart.service')?.child.exit(3);
    await second;
    expect(r.messages.at(-1)).toEqual({ type: 'status', state: 'failed', message: 'The restart ended with status 3.' });
  });

  it('shows journalctl’s own complaints (such as no permission to read the journal) as errors', async () => {
    const h = harness();
    const finished = runUpdate(h.send, new AbortController().signal, h.io);
    await tick();
    h.journalFor('kiosk-pull.service')?.child.stderr.emit(
      'data',
      Buffer.from('No journal files were opened due to insufficient permissions.\n')
    );
    h.journalFor('kiosk-pull.service')?.child.emit('error', new Error('spawn failed'));
    h.systemctlFor('kiosk-pull.service')?.child.exit(0);
    await finished;
    expect(h.messages).toContainEqual({
      type: 'error',
      line: 'No journal files were opened due to insufficient permissions.'
    });
    expect(h.messages).toContainEqual({ type: 'error', line: 'journalctl: spawn failed' });
  });

  it('stops the follower when the app goes away, and does not go on to the restart', async () => {
    const h = harness({ marker: true });
    const controller = new AbortController();
    const finished = runUpdate(h.send, controller.signal, h.io);
    await tick();
    const journal = h.journalFor('kiosk-pull.service')?.child;
    controller.abort();
    await tick();
    expect(journal?.killed).toEqual(['SIGTERM']);
    // The pull itself goes on by itself; once it ends nothing more is started or sent.
    const sent = h.messages.length;
    h.systemctlFor('kiosk-pull.service')?.child.exit(0);
    await finished;
    expect(h.messages).toHaveLength(sent);
    expect(h.systemctlFor('kiosk-restart.service')).toBeUndefined();
  });

  it('kills a follower that ignores SIGTERM, and every follower when the service stops', async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      const stubborn = new FakeChild();
      stubborn.kill = (signal: string) => {
        stubborn.killed.push(signal);
        if (signal === 'SIGKILL') queueMicrotask(() => stubborn.emit('exit', null, signal));
        return true;
      };
      h.io.spawn = (file, args) => {
        const child = file.endsWith('journalctl') ? stubborn : new FakeChild();
        h.spawned.push({ file, args, child });
        return child as unknown as ChildProcess;
      };
      const finished = runUpdate(h.send, new AbortController().signal, h.io);
      await vi.advanceTimersByTimeAsync(0);
      h.systemctlFor('kiosk-pull.service')?.child.exit(0);
      await vi.advanceTimersByTimeAsync(2500);
      await finished;
      expect(stubborn.killed).toEqual(['SIGTERM', 'SIGKILL']);
    } finally {
      vi.useRealTimers();
    }

    const h = harness();
    void runUpdate(h.send, new AbortController().signal, h.io);
    await tick();
    const journal = h.journalFor('kiosk-pull.service')?.child;
    stopFollowers();
    expect(journal?.killed).toEqual(['SIGKILL']);
  });
});
