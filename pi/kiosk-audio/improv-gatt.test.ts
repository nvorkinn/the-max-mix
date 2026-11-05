// @vitest-environment node
import { createBroker, createClient, defineInterface } from 'dbus-native';
import type { DBusBroker, MessageBus } from 'dbus-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wifiPacket } from './fixtures.ts';
import { advertise, SERVICE_DATA_UUID } from './improv-gatt.ts';
import { CHARACTERISTICS, ErrorCode, ImprovSession, SERVICE_UUID, State } from './improv.ts';

const APP = '/org/themaxmix/improv';
const CHARACTERISTIC = 'org.bluez.GattCharacteristic1';
type Objects = Record<string, Record<string, Record<string, unknown>>>;
/** The calls the tests make on the objects the kiosk exports, as the proxies offer them. */
interface Remote {
  GetManagedObjects: () => Promise<Objects>;
  ReadValue: (options: object) => Promise<Buffer>;
  WriteValue: (value: Buffer, options: object) => Promise<void>;
  $props: { $all: () => Promise<Record<string, unknown>> };
}

const bus = { broker: undefined as DBusBroker | undefined, clients: [] as MessageBus[], registered: [] as string[] };
const okSession = () => new ImprovSession(() => Promise.resolve({ ok: true }));

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

const registerManager = (name: string, add: string, remove: string) =>
  defineInterface({
    name,
    methods: {
      [add]: {
        in: { path: 'o', options: 'a{sv}' },
        handler: ({ path }: { path: string }) => {
          bus.registered.push(`+${path}`);
        }
      },
      [remove]: {
        in: { path: 'o' },
        handler: ({ path }: { path: string }) => {
          bus.registered.push(`-${path}`);
        }
      }
    }
  });

/** A stand-in for BlueZ: it owns org.bluez and notes what is registered with it. */
async function fakeBluez(): Promise<MessageBus> {
  const bluez = await client();
  await bluez.ownName('org.bluez');
  await bluez.export(
    '/org/bluez/hci0',
    registerManager('org.bluez.GattManager1', 'RegisterApplication', 'UnregisterApplication')
  );
  await bluez.export(
    '/org/bluez/hci0',
    registerManager('org.bluez.LEAdvertisingManager1', 'RegisterAdvertisement', 'UnregisterAdvertisement')
  );
  return bluez;
}

/** What BlueZ sees of an object the kiosk exports. */
const remote = async (bluez: MessageBus, owner: MessageBus, path: string, iface?: string): Promise<Remote> =>
  (await bluez.proxy(owner.name ?? '', path, iface ? { interface: iface } : {})) as unknown as Remote;

beforeEach(async () => {
  bus.registered = [];
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

describe('kiosk-audio/improv-gatt', () => {
  it('registers the service and the advertisement with BlueZ, and unregisters them', async () => {
    await fakeBluez();
    const advertising = await advertise(okSession(), await client());
    expect(bus.registered).toEqual([`+${APP}`, '+/org/themaxmix/improv_adv']);

    await advertising.stop();
    expect(bus.registered.slice(2)).toEqual(['-/org/themaxmix/improv_adv', `-${APP}`]);
    await advertising.stop();
    expect(bus.registered).toHaveLength(4);
  });

  it('serves the Improv service: the characteristics, their values, and the command', async () => {
    const bluez = await fakeBluez();
    const joined = vi.fn().mockResolvedValue({ ok: true });
    const session = new ImprovSession(joined);
    const owner = await client();
    const advertising = await advertise(session, owner);

    const objects = await (await remote(bluez, owner, APP)).GetManagedObjects();
    expect(objects[`${APP}/service0`]?.['org.bluez.GattService1']).toMatchObject({ UUID: SERVICE_UUID, Primary: true });
    const found = Object.entries(objects)
      .map(([path, interfaces]) => ({ path, properties: interfaces[CHARACTERISTIC] }))
      .filter(entry => entry.properties)
      .toSorted((a, b) => a.path.localeCompare(b.path));
    expect(found.map(entry => entry.properties?.['UUID'])).toEqual(Object.values(CHARACTERISTICS));
    expect(found.map(entry => entry.properties?.['Flags'])).toEqual([
      ['read', 'notify'],
      ['read', 'notify'],
      ['write'],
      ['read', 'notify'],
      ['read']
    ]);

    const read = async (index: number) => [
      ...(await (await remote(bluez, owner, `${APP}/service0/char${index}`, CHARACTERISTIC)).ReadValue({}))
    ];
    expect(await read(0)).toEqual([State.authorized]);
    expect(await read(1)).toEqual([ErrorCode.none]);
    expect(await read(4)).toEqual([0]);

    const command = await remote(bluez, owner, `${APP}/service0/char2`, CHARACTERISTIC);
    await command.WriteValue(Buffer.from(wifiPacket('Home', 'placeholder-pass')), {});
    await vi.waitFor(() => {
      expect(session.state).toBe(State.provisioned);
    });
    expect(joined).toHaveBeenCalledWith({ ssid: 'Home', password: 'placeholder-pass', hidden: false, security: 'psk' });
    expect(await read(0)).toEqual([State.provisioned]);
    expect(await read(3)).toEqual([1, 0, 1]);
    await advertising.stop();
  });

  it('advertises as THE MAX MIX with the Improv service', async () => {
    const bluez = await fakeBluez();
    const owner = await client();
    const advertising = await advertise(okSession(), owner);
    const advert = await remote(bluez, owner, '/org/themaxmix/improv_adv', 'org.bluez.LEAdvertisement1');
    const properties = await advert.$props.$all();
    expect(properties).toMatchObject({ Type: 'peripheral', LocalName: 'THE MAX MIX', ServiceUUIDs: [SERVICE_UUID] });
    const data = (properties['ServiceData'] as Record<string, Buffer>)[SERVICE_DATA_UUID];
    expect([...(data ?? [])]).toEqual([State.authorized, 0, 0, 0, 0, 0]);
    // It has to fit in the 31 bytes of an advertisement: flags (3), the service UUID (2 + 16) and the service data (2 + 2 + 6).
    expect(3 + (2 + 16) + (2 + 2 + (data?.length ?? 0))).toBeLessThanOrEqual(31);
    expect(SERVICE_DATA_UUID).toMatch(/^0000[\da-f]{4}-0000-1000-8000-00805f9b34fb$/);
    await advertising.stop();
  });

  it('notifies the phone of each change with a PropertiesChanged on the characteristic', async () => {
    const bluez = await fakeBluez();
    const owner = await client();
    const session = new ImprovSession(() => Promise.resolve({ ok: false, error: 'No.' }));
    const advertising = await advertise(session, owner);

    const changes: { path: string; value: number[] }[] = [];
    await bluez.addMatch("type='signal',interface='org.freedesktop.DBus.Properties'");
    bluez.connection.on('message', (message: { path?: string; member?: string; body?: unknown[] }) => {
      const value = (message.body?.[1] as Record<string, Buffer> | undefined)?.['Value'];
      if (value && message.path && message.member === 'PropertiesChanged') {
        changes.push({ path: message.path, value: [...value] });
      }
    });
    await session.handle(wifiPacket('Home', 'placeholder-pass'));
    await vi.waitFor(() => {
      expect(changes.length).toBeGreaterThanOrEqual(3);
    });
    expect(changes).toContainEqual({ path: `${APP}/service0/char0`, value: [State.provisioning] });
    expect(changes).toContainEqual({ path: `${APP}/service0/char1`, value: [ErrorCode.unableToConnect] });
    await advertising.stop();
  });

  it('says so when BlueZ is not there', async () => {
    const owner = await client();
    await expect(advertise(okSession(), owner)).rejects.toThrow('Bluetooth would not start the phone setup.');
  });
});
