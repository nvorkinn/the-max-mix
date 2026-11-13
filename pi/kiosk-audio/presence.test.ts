// @vitest-environment node
import { createBroker, createClient, defineInterface } from 'dbus-native';
import type { DBusBroker, MessageBus } from 'dbus-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Presence, scanLe, setAlias } from './presence.ts';

const PHONE = { address: '4F:00:00:00:00:03', name: 'Nikolai’s iPhone', pairedAt: 1 };
/** Named after the passing address BlueZ first heard, not the phone's own. */
const PATH = '/org/bluez/hci0/dev_6A_11_22_33_44_55';

function setUp(options: { phones?: (typeof PHONE)[]; isScanFailing?: boolean } = {}) {
  const heard = {
    lastSeen: null as number | null,
    connected: false,
    name: 'Nikolai’s iPhone',
    bluezName: 'Nikolai’s iPhone'
  };
  const scan = vi.fn(() => (options.isScanFailing ? Promise.reject(new Error('No adapter')) : Promise.resolve()));
  const log = vi.fn();
  const devices = vi.fn(() => Promise.resolve([{ address: PHONE.address, path: PATH, ...heard }]));
  const rename = vi.fn((_address: string, name: string) => {
    heard.name = name;
    return Promise.resolve();
  });
  const saveName = vi.fn(() => Promise.resolve());
  const presence = new Presence({
    phones: () => Promise.resolve(options.phones ?? [PHONE]),
    saveName,
    devices,
    scan,
    rename,
    log,
    now: () => Date.now(),
    everyMs: 30_000,
    burstMs: 8000,
    awayAfterMs: 120_000
  });
  return { presence, heard, scan, rename, saveName, log, devices };
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

  it('names a phone BlueZ renamed from an advert back to the name it paired with', async () => {
    const { presence, heard, rename, log } = setUp();
    heard.name = '4';
    await presence.check();
    expect(rename).toHaveBeenCalledWith(PATH, 'Nikolai’s iPhone');
    expect(presence.status()[0]?.name).toBe('Nikolai’s iPhone');
    await presence.check();
    expect(rename).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('Presence: 4 named Nikolai’s iPhone again');
  });

  it('saves the full name a paired phone gives once it is connected, and shows it', async () => {
    const { presence, heard, rename, saveName, log } = setUp({ phones: [{ ...PHONE, name: 'iPhone' }] });
    heard.name = 'iPhone';
    heard.connected = true;
    await presence.check();
    expect(saveName).toHaveBeenCalledWith(PHONE.address, 'Nikolai’s iPhone');
    expect(presence.status()[0]?.name).toBe('Nikolai’s iPhone');
    expect(rename).toHaveBeenCalledWith(PATH, 'Nikolai’s iPhone');
    expect(log).toHaveBeenCalledWith('Presence: iPhone is called Nikolai’s iPhone');
  });

  it('does not save a name heard in an advert while the phone is not connected', async () => {
    const { presence, heard, saveName } = setUp();
    heard.bluezName = '4';
    await presence.check();
    expect(saveName).not.toHaveBeenCalled();
    expect(presence.status()[0]?.name).toBe('Nikolai’s iPhone');
  });

  it('saves a name that adds to the saved one, even from an advert, but not an unrelated one', async () => {
    const { presence, heard, saveName } = setUp({ phones: [{ ...PHONE, name: 'iPhone' }] });
    heard.bluezName = '4';
    await presence.check();
    expect(saveName).not.toHaveBeenCalled();
    heard.bluezName = 'Nikolai’s iPhone';
    await presence.check();
    expect(saveName).toHaveBeenCalledWith(PHONE.address, 'Nikolai’s iPhone');
    expect(presence.status()[0]?.name).toBe('Nikolai’s iPhone');
  });

  it('gives a phone saved under its address the first name heard, but never an address', async () => {
    const { presence, heard, saveName } = setUp({ phones: [{ ...PHONE, name: PHONE.address }] });
    heard.bluezName = 'A1-B2-C3-D4-E5-F6';
    await presence.check();
    expect(saveName).not.toHaveBeenCalled();
    heard.bluezName = 'iPhone';
    await presence.check();
    expect(saveName).toHaveBeenCalledWith(PHONE.address, 'iPhone');
  });

  it('keeps the saved name when the new one cannot be saved', async () => {
    const { presence, heard, saveName, log } = setUp({ phones: [{ ...PHONE, name: 'iPhone' }] });
    heard.connected = true;
    saveName.mockImplementation(() => Promise.reject(new Error('Read-only')));
    await presence.check();
    expect(log).toHaveBeenCalledWith('Presence: could not save Nikolai’s iPhone: Error: Read-only');
    expect(presence.status()[0]?.name).toBe('iPhone');
  });

  it('logs a failing rename once and does not try again', async () => {
    const { presence, heard, rename, log } = setUp();
    heard.name = '4';
    rename.mockImplementation(() => Promise.reject(new Error('No such device')));
    await presence.check();
    await presence.check();
    expect(rename).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('Presence: could not name 4 Nikolai’s iPhone: Error: No such device');
    expect(presence.status()[0]?.name).toBe('Nikolai’s iPhone');
  });

  it('leaves a phone BlueZ does not know, or one saved with no name, alone', async () => {
    const { presence, rename, devices } = setUp({ phones: [{ ...PHONE, name: '' }] });
    await presence.check();
    devices.mockImplementation(() => Promise.resolve([]));
    await presence.check();
    expect(rename).not.toHaveBeenCalled();
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

  it('sets the Alias of the device at a D-Bus path', async () => {
    const aliases: unknown[] = [];
    const bluez = await client();
    await bluez.ownName('org.bluez');
    await bluez.export(
      PATH,
      defineInterface({
        name: 'org.bluez.Device1',
        properties: {
          Alias: {
            type: 's',
            get: () => aliases.at(-1) ?? '4',
            set: value => {
              aliases.push(value);
            }
          }
        }
      })
    );
    await setAlias(PATH, 'Nikolai’s iPhone', await client());
    expect(aliases).toEqual(['Nikolai’s iPhone']);
  });

  it('rejects when there is no adapter', async () => {
    await (await client()).ownName('org.bluez');
    await expect(scanLe(20, await client())).rejects.toThrow();
  });
});
