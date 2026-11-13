// @vitest-environment node
import { createBroker, createClient, defineInterface } from 'dbus-native';
import type { DBusBroker, MessageBus } from 'dbus-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Presence, scanLe } from './presence.ts';

const PHONE = { address: '4F:00:00:00:00:03', name: 'iPhone', pairedAt: 1 };

function setUp(options: { phones?: (typeof PHONE)[]; isScanFailing?: boolean } = {}) {
  const heard = { lastSeen: null as number | null, connected: false };
  const scan = vi.fn(() => (options.isScanFailing ? Promise.reject(new Error('No adapter')) : Promise.resolve()));
  const log = vi.fn();
  const devices = vi.fn(() => Promise.resolve([{ address: PHONE.address, name: 'Nikolai’s iPhone', ...heard }]));
  const presence = new Presence({
    phones: () => Promise.resolve(options.phones ?? [PHONE]),
    devices,
    scan,
    log,
    now: () => Date.now(),
    everyMs: 30_000,
    burstMs: 8000,
    awayAfterMs: 120_000
  });
  return { presence, heard, scan, log, devices };
}

describe('Presence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('scans every 30 s and says a phone is here while it was heard in the last two minutes', async () => {
    const { presence, heard, scan, log } = setUp();
    presence.start();
    presence.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(scan).toHaveBeenCalledWith(8000);
    expect(presence.status()).toEqual([
      { address: PHONE.address, name: 'Nikolai’s iPhone', isHere: false, lastSeen: null }
    ]);
    heard.lastSeen = Date.now();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(presence.status()[0]).toMatchObject({ isHere: true, lastSeen: heard.lastSeen });
    expect(scan).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(presence.status()[0]?.isHere).toBe(false);
    heard.connected = true;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(presence.status()[0]?.isHere).toBe(true);
    presence.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(scan).toHaveBeenCalledTimes(7);
    expect(log.mock.calls.map(([message]) => String(message))).toEqual([
      'Presence: Nikolai’s iPhone is away',
      'Presence: Nikolai’s iPhone is here',
      'Presence: Nikolai’s iPhone is away',
      'Presence: Nikolai’s iPhone is here'
    ]);
  });

  it('does not scan with no phone saved', async () => {
    const { presence, scan, devices } = setUp({ phones: [] });
    await presence.check();
    expect(scan).not.toHaveBeenCalled();
    expect(devices).not.toHaveBeenCalled();
    expect(presence.status()).toEqual([]);
  });

  it('logs a failing scan once, and still says who was heard', async () => {
    const { presence, log } = setUp({ isScanFailing: true });
    await Promise.all([presence.check(), presence.check()]);
    await presence.check();
    expect(log.mock.calls.map(([message]) => String(message))).toEqual([
      'Presence: scan failed: Error: No adapter',
      'Presence: Nikolai’s iPhone is away'
    ]);
  });

  it('logs when BlueZ cannot say', async () => {
    const { presence, log, devices } = setUp();
    devices.mockImplementation(() => Promise.reject(new Error('Bluetooth is not available on this device.')));
    await presence.check();
    expect(log).toHaveBeenCalledWith('Presence: Error: Bluetooth is not available on this device.');
  });
});

describe('scanLe', () => {
  const bus = { broker: undefined as DBusBroker | undefined, clients: [] as MessageBus[] };

  async function client(): Promise<MessageBus> {
    const connection = createClient({ busAddress: bus.broker?.address() ?? '', authMethods: ['ANONYMOUS'] });
    bus.clients.push(connection);
    while (!connection.name) {
      // Waits for the hello reply.
      // eslint-disable-next-line no-await-in-loop
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    return connection;
  }

  beforeEach(async () => {
    bus.broker = createBroker({ anonymous: true, authMethods: ['ANONYMOUS'] });
    const broker = bus.broker;
    await new Promise<void>((resolve, reject) => {
      broker.listen({ port: 0, host: '127.0.0.1' }, error => {
        if (error) reject(error);
        else resolve();
      });
    });
  });

  afterEach(async () => {
    await Promise.allSettled(bus.clients.map(connection => connection.close()));
    bus.clients = [];
    const broker = bus.broker;
    await new Promise<void>(resolve => broker?.close(resolve));
  });

  it('asks the adapter for an LE-only scan, and stops it', async () => {
    const calls: unknown[] = [];
    const bluez = await client();
    await bluez.ownName('org.bluez');
    await bluez.export(
      '/org/bluez/hci0',
      defineInterface({
        name: 'org.bluez.Adapter1',
        methods: {
          SetDiscoveryFilter: {
            in: { filter: 'a{sv}' },
            handler: ({ filter }: { filter: unknown }) => {
              calls.push(filter);
            }
          },
          StartDiscovery: {
            handler: () => {
              calls.push('start');
            }
          },
          StopDiscovery: {
            handler: () => {
              calls.push('stop');
            }
          }
        }
      })
    );
    await scanLe(20, await client());
    expect(calls).toEqual([{ Transport: 'le', DuplicateData: true }, 'start', 'stop']);
  });

  it('rejects when there is no adapter', async () => {
    await (await client()).ownName('org.bluez');
    await expect(scanLe(20, await client())).rejects.toThrow();
  });
});
