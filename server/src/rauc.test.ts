// @vitest-environment node
import type { MessageBus } from 'dbus-native';
import { describe, expect, it, vi } from 'vitest';
import { inspectedVersion, raucOverDbus, toProgress, toSlot } from './rauc.ts';
import type { Progress } from './rauc.ts';

interface Call {
  interface: string | undefined;
  member: string | undefined;
  body: unknown[] | undefined;
}

/** RAUC on a fake system bus: `completed` is the code its Completed signal sends after an install. */
function fakeRauc(completed = 0) {
  const calls: Call[] = [];
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const removed: string[] = [];
  const properties: Record<string, unknown> = {
    // As RAUC gives it with no rauc.slot= on the kernel command line.
    BootSlot: '/dev/mmcblk0p4',
    Operation: 'idle',
    LastError: 'Failed to download bundle: 404'
  };
  const bus = {
    name: ':1.42',
    invoke: (message: { interface?: string; member?: string; body?: unknown[] }) => {
      calls.push({ interface: message.interface, member: message.member, body: message.body });
      switch (message.member) {
        case 'Get': {
          return Promise.resolve(properties[String(message.body?.[1])]);
        }
        case 'GetSlotStatus': {
          return Promise.resolve([
            ['rootfs.0', { class: 'rootfs', bootname: 'a', state: 'booted' }],
            ['rootfs.1', { class: 'rootfs', bootname: 'b', state: 'inactive', 'bundle.version': 'v2+bbb' }]
          ]);
        }
        case 'InspectBundle': {
          return Promise.resolve({ update: { compatible: 'the-max-mix-pi', version: 'v3+ccc' } });
        }
        case 'InstallBundle': {
          setImmediate(() => {
            handlers['PropertiesChanged']?.('de.pengutronix.rauc.Installer', { Progress: [40, 'Copying image', 1] });
            handlers['PropertiesChanged']?.('de.pengutronix.rauc.Installer', { Operation: 'installing' });
            handlers['Completed']?.(completed);
          });
          return Promise.resolve();
        }
        default: {
          return Promise.resolve(['a', 'marked']);
        }
      }
    },
    proxy: () =>
      Promise.resolve({
        $watch: (signal: string, handler: (...args: unknown[]) => void) => {
          handlers[signal] = handler;
          return Promise.resolve({
            remove: () => {
              removed.push(signal);
              return Promise.resolve();
            }
          });
        }
      }),
    close: () => Promise.resolve()
  };
  return { bus: bus as unknown as MessageBus, calls, removed };
}

describe('raucOverDbus', () => {
  it('reads the booted slot, the slots and a bundle’s version', async () => {
    const { bus, calls } = fakeRauc();
    const rauc = await raucOverDbus(bus);
    await expect(rauc.bootSlot()).resolves.toBe('a');
    await expect(rauc.operation()).resolves.toBe('idle');
    await expect(rauc.slots()).resolves.toEqual([
      { name: 'rootfs.0', class: 'rootfs', bootname: 'a', state: 'booted', bundleVersion: null },
      { name: 'rootfs.1', class: 'rootfs', bootname: 'b', state: 'inactive', bundleVersion: 'v2+bbb' }
    ]);
    await expect(rauc.inspect('https://example.test/b.raucb')).resolves.toBe('v3+ccc');
    expect(calls.at(-1)).toEqual({
      interface: 'de.pengutronix.rauc.Installer',
      member: 'InspectBundle',
      body: ['https://example.test/b.raucb', {}]
    });
  });

  it('installs with its progress, and stops listening afterwards', async () => {
    const { bus, removed } = fakeRauc();
    const rauc = await raucOverDbus(bus);
    const progress: Progress[] = [];
    await rauc.install('https://example.test/b.raucb', step => {
      progress.push(step);
    });
    expect(progress).toEqual([{ percent: 40, message: 'Copying image' }]);
    expect(removed.toSorted((a, b) => a.localeCompare(b))).toEqual(['Completed', 'PropertiesChanged']);
  });

  it('rejects with RAUC’s own error when the install fails', async () => {
    const rauc = await raucOverDbus(fakeRauc(1).bus);
    await expect(rauc.install('https://example.test/b.raucb', vi.fn())).rejects.toThrow(
      'Failed to download bundle: 404'
    );
  });

  it('marks slots', async () => {
    const { bus, calls } = fakeRauc();
    await (await raucOverDbus(bus)).mark('good', 'booted');
    expect(calls.at(-1)).toEqual({
      interface: 'de.pengutronix.rauc.Installer',
      member: 'Mark',
      body: ['good', 'booted']
    });
  });
});

describe('RAUC’s values', () => {
  it('reads slots, versions and progress in either shape, and ignores the rest', () => {
    expect(toSlot('boot.1', { state: 'inactive' })).toEqual({
      name: 'boot.1',
      class: 'boot',
      bootname: null,
      state: 'inactive',
      bundleVersion: null
    });
    expect(inspectedVersion({ version: 'v1+aaa' })).toBe('v1+aaa');
    expect(inspectedVersion({ update: {} })).toBeNull();
    expect(toProgress([100, 'Installing done.', 1])).toEqual({ percent: 100, message: 'Installing done.' });
    expect(toProgress('nope')).toBeNull();
  });
});
