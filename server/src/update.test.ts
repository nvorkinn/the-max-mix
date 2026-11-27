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

function harness() {
  const spawned: Spawned[] = [];
  const order: string[] = [];
  const io: UpdateIO = {
    spawn: (file, args) => {
      const child = new FakeChild();
      spawned.push({ file, args, child });
      order.push(`${file.split('/').at(-1)} ${args.join(' ')}`.trim());
      return child as unknown as ChildProcess;
    },
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
  it('runs kiosk-update.service while its journal streams, and says what waits for a restart', async () => {
    const h = harness();
    const finished = runUpdate(h.send, new AbortController().signal, () => Promise.resolve('dev+bbb'), h.io);
    await tick();
    expect(h.order).toEqual([
      'journalctl --unit kiosk-update.service --follow --since=@1700000000 --output short-iso --no-hostname --no-pager',
      'systemctl start kiosk-update.service'
    ]);
    h.journalFor('kiosk-update.service')?.child.print('… kiosk-update[1]: Update progress: 40% Copying image\n');
    h.systemctlFor('kiosk-update.service')?.child.exit(0);
    await finished;
    expect(h.messages).toEqual([
      { type: 'status', state: 'installing' },
      { type: 'log', line: '… kiosk-update[1]: Update progress: 40% Copying image' },
      { type: 'status', state: 'installed', message: 'dev+bbb' }
    ]);
  });

  it('is done when nothing newer was installed, and reports a failed unit', async () => {
    const h = harness();
    const finished = runUpdate(h.send, new AbortController().signal, () => Promise.resolve(null), h.io);
    await tick();
    h.systemctlFor('kiosk-update.service')?.child.exit(0);
    await finished;
    expect(h.messages.at(-1)).toEqual({ type: 'status', state: 'done' });

    const failing = harness();
    const failed = runUpdate(failing.send, new AbortController().signal, () => Promise.resolve(null), failing.io);
    await tick();
    failing.systemctlFor('kiosk-update.service')?.child.exit(1);
    await failed;
    expect(failing.messages.at(-1)).toEqual({
      type: 'status',
      state: 'failed',
      message: 'The update ended with status 1.'
    });
  });

  it('says the Pi is restarting when the unit restarts it into the update', async () => {
    const h = harness();
    const finished = runUpdate(h.send, new AbortController().signal, () => Promise.resolve('dev+bbb'), h.io);
    await tick();
    h.journalFor('kiosk-update.service')?.child.print('… kiosk-update[1]: Restarting into the update.\n');
    // The reboot ends systemctl (and this service) without a status.
    h.systemctlFor('kiosk-update.service')?.child.emit('exit', null, 'SIGTERM');
    await finished;
    expect(h.messages.filter(message => message.type === 'status')).toEqual([
      { type: 'status', state: 'installing' },
      { type: 'status', state: 'restarting' }
    ]);
  });

  it('shows journalctl’s own complaints (such as no permission to read the journal) as errors', async () => {
    const h = harness();
    const finished = runUpdate(h.send, new AbortController().signal, () => Promise.resolve(null), h.io);
    await tick();
    h.journalFor('kiosk-update.service')?.child.stderr.emit(
      'data',
      Buffer.from('No journal files were opened due to insufficient permissions.\n')
    );
    h.journalFor('kiosk-update.service')?.child.emit('error', new Error('spawn failed'));
    h.systemctlFor('kiosk-update.service')?.child.exit(0);
    await finished;
    expect(h.messages).toContainEqual({
      type: 'error',
      line: 'No journal files were opened due to insufficient permissions.'
    });
    expect(h.messages).toContainEqual({ type: 'error', line: 'journalctl: spawn failed' });
  });

  it('stops the follower when the app goes away, and sends nothing more', async () => {
    const h = harness();
    const controller = new AbortController();
    const finished = runUpdate(h.send, controller.signal, () => Promise.resolve('dev+bbb'), h.io);
    await tick();
    const journal = h.journalFor('kiosk-update.service')?.child;
    controller.abort();
    await tick();
    expect(journal?.killed).toEqual(['SIGTERM']);
    // The unit goes on by itself; once it ends nothing more is sent.
    const sent = h.messages.length;
    h.systemctlFor('kiosk-update.service')?.child.exit(0);
    await finished;
    expect(h.messages).toHaveLength(sent);
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
      const finished = runUpdate(h.send, new AbortController().signal, () => Promise.resolve(null), h.io);
      await vi.advanceTimersByTimeAsync(0);
      h.systemctlFor('kiosk-update.service')?.child.exit(0);
      await vi.advanceTimersByTimeAsync(2500);
      await finished;
      expect(stubborn.killed).toEqual(['SIGTERM', 'SIGKILL']);
    } finally {
      vi.useRealTimers();
    }

    const h = harness();
    void runUpdate(h.send, new AbortController().signal, () => Promise.resolve(null), h.io);
    await tick();
    const journal = h.journalFor('kiosk-update.service')?.child;
    stopFollowers();
    expect(journal?.killed).toEqual(['SIGKILL']);
  });
});
