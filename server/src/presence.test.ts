// @vitest-environment node
import { createBroker, createClient, defineInterface } from 'dbus-native';
import type { DBusBroker, MessageBus } from 'dbus-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Presence, scanLe } from './presence.ts';

const PHONE = { address: '1C:3C:78:F2:61:1D', name: 'Nikolai’s iPhone', pairedAt: 1 };

function setUp(options: { phones?: (typeof PHONE)[]; isScanFailing?: boolean } = {}) {
  const heard = { lastSeen: null as number | null, connected: false };
  const signals: AbortSignal[] = [];
  const scan = vi.fn((signal: AbortSignal) => {
    signals.push(signal);
    if (options.isScanFailing) return Promise.reject(new Error('No adapter'));
    return new Promise<void>(resolve => {
      signal.addEventListener(
        'abort',
        () => {
          resolve();
        },
        { once: true }
      );
    });
  });
  const log = vi.fn();
  const devices = vi.fn(() => Promise.resolve([{ address: PHONE.address, ...heard }]));
  const presence = new Presence({
    phones: () => Promise.resolve(options.phones ?? [PHONE]),
    devices,
    scan,
    log,
    now: () => Date.now(),
    watchMs: 120_000,
    checkingMs: 8000,
    awayAfterMs: 120_000
  });
  return { presence, heard, scan, signals, log, devices };
}

describe('Presence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not scan until the app watches', async () => {
    const { scan } = setUp();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(scan).not.toHaveBeenCalled();
  });

  it('scans while watched and says a phone is here while it was heard in the last two minutes', async () => {
    const { presence, heard, scan, signals, log } = setUp();
    presence.watch();
    presence.watch();
    await vi.advanceTimersByTimeAsync(0);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(await presence.status()).toEqual({
      isChecking: true,
      phones: [{ address: PHONE.address, name: 'Nikolai’s iPhone', isHere: false, lastSeen: null }]
    });
    heard.lastSeen = Date.now();
    expect((await presence.status()).phones[0]).toMatchObject({ isHere: true, lastSeen: heard.lastSeen });
    await vi.advanceTimersByTimeAsync(8000);
    expect((await presence.status()).isChecking).toBe(false);
    presence.unwatch();
    expect(signals[0]?.aborted).toBe(true);
    expect((await presence.status()).isChecking).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    expect((await presence.status()).phones[0]?.isHere).toBe(false);
    heard.connected = true;
    expect((await presence.status()).phones[0]?.isHere).toBe(true);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.map(([message]) => String(message))).toEqual([
      'Presence: Nikolai’s iPhone is away',
      'Presence: Nikolai’s iPhone is here',
      'Presence: Nikolai’s iPhone is away',
      'Presence: Nikolai’s iPhone is here'
    ]);
  });

  it('stops scanning two minutes after the last watch', async () => {
    const { presence, scan, signals } = setUp();
    presence.watch();
    await vi.advanceTimersByTimeAsync(100_000);
    presence.watch();
    await vi.advanceTimersByTimeAsync(100_000);
    expect(signals[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(signals[0]?.aborted).toBe(true);
    expect(scan).toHaveBeenCalledTimes(1);
    presence.watch();
    await vi.advanceTimersByTimeAsync(0);
    expect(scan).toHaveBeenCalledTimes(2);
    expect((await presence.status()).isChecking).toBe(true);
  });

  it('does not scan with no phone saved', async () => {
    const { presence, scan, devices } = setUp({ phones: [] });
    presence.watch();
    await vi.advanceTimersByTimeAsync(0);
    expect(scan).not.toHaveBeenCalled();
    expect((await presence.status()).phones).toEqual([]);
    expect(devices).not.toHaveBeenCalled();
  });

  it('logs a failing scan once, and still says who was heard', async () => {
    const { presence, log } = setUp({ isScanFailing: true });
    presence.watch();
    await vi.advanceTimersByTimeAsync(0);
    presence.unwatch();
    presence.watch();
    await vi.advanceTimersByTimeAsync(0);
    await presence.status();
    expect(log.mock.calls.map(([message]) => String(message))).toEqual([
      'Presence: scan failed: Error: No adapter',
      'Presence: Nikolai’s iPhone is away'
    ]);
  });

  it('says nothing about a phone BlueZ does not know', async () => {
    const { presence, devices } = setUp();
    devices.mockImplementation(() => Promise.resolve([]));
    expect((await presence.status()).phones).toEqual([
      { address: PHONE.address, name: PHONE.name, isHere: false, lastSeen: null }
    ]);
  });

  it('logs when BlueZ cannot say', async () => {
    const { presence, log, devices } = setUp();
    devices.mockImplementation(() => Promise.reject(new Error('Bluetooth is not available on this device.')));
    await presence.status();
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
    await scanLe(AbortSignal.timeout(20), await client());
    expect(calls).toEqual([{ Transport: 'le', DuplicateData: true }, 'start', 'stop']);
  });

  it('rejects when there is no adapter', async () => {
    await (await client()).ownName('org.bluez');
    await expect(scanLe(new AbortController().signal, await client())).rejects.toThrow();
  });
});
