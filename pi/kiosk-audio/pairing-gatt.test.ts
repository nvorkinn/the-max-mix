// @vitest-environment node
import { createBroker, createClient, defineInterface } from 'dbus-native';
import type { DBusBroker, MessageBus } from 'dbus-native';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { advertiseForPairing, CHARACTERISTICS, HID_SERVICE } from './pairing-gatt.ts';

const APP = '/org/themaxmix/pairing';
const AGENT = '/org/themaxmix/pairing_agent';
const CHARACTERISTIC = 'org.bluez.GattCharacteristic1';
type Objects = Record<string, Record<string, Record<string, unknown>>>;
interface Remote {
  GetManagedObjects: () => Promise<Objects>;
  ReadValue: (options: object) => Promise<Buffer>;
  RequestConfirmation: (device: string, passkey: number) => Promise<void>;
  RequestPinCode: (device: string) => Promise<string>;
  $props: { $all: () => Promise<Record<string, unknown>> };
}

const bus = { broker: undefined as DBusBroker | undefined, clients: [] as MessageBus[], registered: [] as string[] };

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

/** A BlueZ manager interface that notes what is registered and unregistered with it. */
const manager = (name: string, add: string, remove: string, inSignature: Record<string, string>) =>
  defineInterface({
    name,
    methods: {
      [add]: {
        in: inSignature,
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
  const withOptions = { path: 'o', options: 'a{sv}' };
  await bluez.export(
    '/org/bluez/hci0',
    manager('org.bluez.GattManager1', 'RegisterApplication', 'UnregisterApplication', withOptions)
  );
  await bluez.export(
    '/org/bluez/hci0',
    manager('org.bluez.LEAdvertisingManager1', 'RegisterAdvertisement', 'UnregisterAdvertisement', withOptions)
  );
  const agents = defineInterface({
    name: 'org.bluez.AgentManager1',
    methods: {
      RegisterAgent: {
        in: { path: 'o', capability: 's' },
        handler: ({ path, capability }: { path: string; capability: string }) => {
          bus.registered.push(`+${path} ${capability}`);
        }
      },
      RequestDefaultAgent: {
        in: { path: 'o' },
        handler: ({ path }: { path: string }) => {
          bus.registered.push(`default ${path}`);
        }
      },
      UnregisterAgent: {
        in: { path: 'o' },
        handler: ({ path }: { path: string }) => {
          bus.registered.push(`-${path}`);
        }
      }
    }
  });
  await bluez.export('/org/bluez', agents);
  return bluez;
}

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

describe('kiosk-audio/pairing-gatt', () => {
  it('registers the agent, the keyboard and its advertisement with BlueZ, and unregisters them', async () => {
    await fakeBluez();
    const advertising = await advertiseForPairing(await client());
    expect(bus.registered).toEqual([
      `+${AGENT} NoInputNoOutput`,
      `default ${AGENT}`,
      `+${APP}`,
      '+/org/themaxmix/pairing_adv'
    ]);
    await advertising.stop();
    expect(bus.registered.slice(4)).toEqual(['-/org/themaxmix/pairing_adv', `-${APP}`, `-${AGENT}`]);
    await advertising.stop();
    expect(bus.registered).toHaveLength(7);
  });

  it('serves a keyboard whose values need an encrypted link, and advertises it as THE MAX MIX', async () => {
    const bluez = await fakeBluez();
    const owner = await client();
    const advertising = await advertiseForPairing(owner);
    const objects = await (await remote(bluez, owner, APP)).GetManagedObjects();
    expect(objects[`${APP}/service0`]?.['org.bluez.GattService1']).toMatchObject({ UUID: HID_SERVICE, Primary: true });
    const characteristics = Object.entries(objects)
      .map(([path, interfaces]) => ({ path, properties: interfaces[CHARACTERISTIC] }))
      .filter(entry => entry.properties)
      .toSorted((a, b) => a.path.localeCompare(b.path));
    expect(characteristics.map(entry => entry.properties?.['UUID'])).toEqual(CHARACTERISTICS.map(spec => spec.uuid));
    for (const entry of characteristics) {
      expect((entry.properties?.['Flags'] as string[]).some(flag => flag.startsWith('encrypt-'))).toBe(true);
    }
    const information = await remote(bluez, owner, `${APP}/service0/char0`, CHARACTERISTIC);
    expect([...(await information.ReadValue({}))]).toEqual([0x11, 0x01, 0x00, 0x02]);

    const advert = await remote(bluez, owner, '/org/themaxmix/pairing_adv', 'org.bluez.LEAdvertisement1');
    expect(await advert.$props.$all()).toMatchObject({
      Type: 'peripheral',
      LocalName: 'THE MAX MIX',
      ServiceUUIDs: [HID_SERVICE],
      Appearance: 0x03_c1
    });
    await advertising.stop();
  });

  it('says yes to a tapped Pair and no to a code', async () => {
    const bluez = await fakeBluez();
    const owner = await client();
    const advertising = await advertiseForPairing(owner);
    const agent = await remote(bluez, owner, AGENT, 'org.bluez.Agent1');
    await expect(agent.RequestConfirmation('/org/bluez/hci0/dev_4F_00_00_00_00_03', 123_456)).resolves.toBeUndefined();
    await expect(agent.RequestPinCode('/org/bluez/hci0/dev_4F_00_00_00_00_03')).rejects.toMatchObject({
      dbusName: 'org.bluez.Error.Rejected'
    });
    await advertising.stop();
  });

  it('takes everything down again when BlueZ refuses', async () => {
    await (await client()).ownName('org.bluez');
    await expect(advertiseForPairing(await client())).rejects.toThrow('Bluetooth would not start pairing.');
  });
});
