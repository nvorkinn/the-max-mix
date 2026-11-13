// @vitest-environment node
/* eslint-disable unicorn/prefer-event-target -- dbus-native's ManagedObjects is an EventEmitter, so the stand-in is one. */
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { BluetoothMonitor, NEARBY_MS } from './bluetooth-monitor.ts';
import type { BluezView } from './bluetooth-monitor.ts';

const ADAPTER_PATH = '/org/bluez/hci0';
const PHONE = `${ADAPTER_PATH}/dev_AA_BB_CC_DD_EE_01`;
const SPEAKER = `${ADAPTER_PATH}/dev_AA_BB_CC_DD_EE_02`;
const STRANGER = `${ADAPTER_PATH}/dev_4F_00_00_00_00_03`;

type Tree = Record<string, Record<string, Record<string, unknown>>>;

/** A BlueZ object tree that changes as the test says, like dbus-native's ManagedObjects. */
class FakeView extends EventEmitter implements BluezView {
  readonly tree: Tree;

  constructor(tree: Tree) {
    super();
    this.tree = tree;
  }

  filter(interfaceName: string): Record<string, Record<string, unknown>> {
    const found: Record<string, Record<string, unknown>> = {};
    for (const [path, interfaces] of Object.entries(this.tree)) {
      const properties = interfaces[interfaceName];
      if (properties) found[path] = properties;
    }
    return found;
  }

  get(path: string) {
    return this.tree[path];
  }

  add(path: string, interfaces: Record<string, Record<string, unknown>>): void {
    this.tree[path] = interfaces;
    this.emit('added', path, interfaces);
  }

  change(path: string, interfaceName: string, changed: Record<string, unknown>): void {
    const interfaces = this.tree[path];
    const properties = interfaces?.[interfaceName];
    if (properties) Object.assign(properties, changed);
    this.emit('changed', path, interfaceName, changed, []);
  }

  remove(path: string): void {
    const names = Object.keys(this.tree[path] ?? {});
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- the fake tree is keyed by object path
    delete this.tree[path];
    this.emit('removed', path, names);
  }
}

const device = (address: string, name: string, extra: Record<string, unknown> = {}) => ({
  'org.bluez.Device1': {
    Address: address,
    Alias: name,
    AddressType: 'public',
    Paired: false,
    Connected: false,
    ...extra
  }
});

function setUp() {
  let clock = 1_000_000;
  const view = new FakeView({
    [ADAPTER_PATH]: {
      'org.bluez.Adapter1': {
        Address: 'B8:27:EB:00:00:00',
        Alias: 'the-max-mix',
        Powered: true,
        Discoverable: false,
        Pairable: true,
        Discovering: false
      }
    },
    [PHONE]: device('AA:BB:CC:DD:EE:01', 'Nikolai’s iPhone', { Paired: true, Bonded: true, Icon: 'phone' }),
    [SPEAKER]: device('AA:BB:CC:DD:EE:02', 'Kitchen speaker', { Paired: true, Connected: true, Icon: 'audio-card' })
  });
  const close = vi.fn(() => Promise.resolve());
  const open = vi.fn(() => Promise.resolve({ view, close }));
  const monitor = new BluetoothMonitor({ open, now: () => clock });
  return {
    view,
    open,
    close,
    monitor,
    tick: (ms: number) => {
      clock += ms;
    },
    messages: async () => (await monitor.snapshot()).log.map(line => line.message)
  };
}

describe('BluetoothMonitor', () => {
  it('reports the adapter and the paired devices, connected first, and starts watching once', async () => {
    const { monitor, open } = setUp();
    const snapshot = await monitor.snapshot();
    expect(snapshot.adapter).toEqual({
      address: 'B8:27:EB:00:00:00',
      name: 'the-max-mix',
      powered: true,
      discoverable: false,
      pairable: true,
      discovering: false
    });
    expect(snapshot.devices.map(known => [known.name, known.connected, known.icon])).toEqual([
      ['Kitchen speaker', true, 'audio-card'],
      ['Nikolai’s iPhone', false, 'phone']
    ]);
    expect(snapshot.devices[1]).toMatchObject({ bonded: true, rssi: null, lastSeen: null, addressType: 'public' });
    expect(snapshot.log.map(line => line.message)).toEqual(['Watching B8:27:EB:00:00:00: powered on, 2 paired']);
    await monitor.snapshot();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('logs the adapter and paired devices changing, and when a paired phone is heard', async () => {
    const { view, monitor, tick, messages } = setUp();
    await monitor.snapshot();
    view.change(ADAPTER_PATH, 'org.bluez.Adapter1', { Discovering: true });
    view.change(PHONE, 'org.bluez.Device1', { Connected: true });
    view.change(PHONE, 'org.bluez.Device1', { RSSI: -61 });
    tick(2000);
    view.change(PHONE, 'org.bluez.Device1', { RSSI: -60 });
    expect(await messages()).toEqual([
      'Watching B8:27:EB:00:00:00: powered on, 2 paired',
      'Scanning on',
      'Nikolai’s iPhone (AA:BB:CC:DD:EE:01): Connected yes',
      'Heard Nikolai’s iPhone (AA:BB:CC:DD:EE:01), -61 dBm'
    ]);
    const phone = (await monitor.snapshot()).devices.find(known => known.name === 'Nikolai’s iPhone');
    expect(phone).toMatchObject({ rssi: -60, lastSeen: 1_002_000 });
    tick(10_000);
    view.change(PHONE, 'org.bluez.Device1', { RSSI: -70 });
    expect((await messages()).at(-1)).toBe('Heard Nikolai’s iPhone (AA:BB:CC:DD:EE:01), -70 dBm');
  });

  it('counts unpaired devices nearby without logging them, unless asked to', async () => {
    const { view, monitor, tick, messages } = setUp();
    await monitor.snapshot();
    view.add(STRANGER, device('4F:00:00:00:00:03', '4F-00-00-00-00-03', { AddressType: 'random', RSSI: -80 }));
    expect((await monitor.snapshot()).nearby).toBe(1);
    expect(await messages()).toHaveLength(1);
    tick(NEARBY_MS);
    expect((await monitor.snapshot()).nearby).toBe(0);
    view.change(STRANGER, 'org.bluez.Device1', { RSSI: -75 });
    expect((await monitor.snapshot()).nearby).toBe(1);

    monitor.setVerbose(true);
    view.change(STRANGER, 'org.bluez.Device1', { RSSI: -74 });
    view.remove(STRANGER);
    const snapshot = await monitor.snapshot();
    expect(snapshot.verbose).toBe(true);
    expect(snapshot.nearby).toBe(0);
    expect(snapshot.log.slice(1).map(line => line.message)).toEqual([
      'Logging unpaired devices too',
      'Heard 4F-00-00-00-00-03 (4F:00:00:00:00:03), -74 dBm',
      'Gone: 4F-00-00-00-00-03 (4F:00:00:00:00:03)'
    ]);
  });

  it('logs a device that becomes paired, and a paired one that is removed', async () => {
    const { view, monitor, messages } = setUp();
    await monitor.snapshot();
    view.add(STRANGER, device('4F:00:00:00:00:03', 'New phone'));
    view.change(STRANGER, 'org.bluez.Device1', { Paired: true });
    view.remove(PHONE);
    expect((await messages()).slice(1)).toEqual([
      'New phone (4F:00:00:00:00:03): Paired yes',
      'Gone: Nikolai’s iPhone (AA:BB:CC:DD:EE:01)'
    ]);
    expect((await monitor.snapshot()).devices.map(known => known.name)).toEqual(['Kitchen speaker', 'New phone']);
  });

  it('says Bluetooth is not available when BlueZ cannot be reached, and tries again next time', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
    const { view } = setUp();
    const open = vi
      .fn()
      .mockRejectedValueOnce(new Error('no system bus'))
      .mockResolvedValue({ view, close: () => Promise.resolve() });
    const monitor = new BluetoothMonitor({ open });
    await expect(monitor.snapshot()).rejects.toThrow('Bluetooth is not available on this device.');
    expect(warn).toHaveBeenCalledWith('bluetooth monitor: Error: no system bus');
    await expect(monitor.snapshot()).resolves.toMatchObject({ devices: [{}, {}] });
    warn.mockRestore();
  });

  it('watches again after BlueZ restarts', async () => {
    const { view, monitor, open, close, messages } = setUp();
    await monitor.snapshot();
    view.emit('stale');
    expect(close).toHaveBeenCalledTimes(1);
    expect(await messages()).toContain('BlueZ restarted; watching again');
    expect(open).toHaveBeenCalledTimes(2);
  });
});
