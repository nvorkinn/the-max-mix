// @vitest-environment node
import { createBroker, createClient, defineInterface } from 'dbus-native';
import type { DBusBroker, MessageBus } from 'dbus-native';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverPhones, nameKiosk } from './phone-discovery.ts';

const AGENT = '/org/themaxmix/pairing_agent';
const PHONE = '/org/bluez/hci0/dev_1C_3C_78_F2_61_1D';
interface Agent {
  RequestConfirmation: (device: string, passkey: number) => Promise<void>;
  RequestPinCode: (device: string) => Promise<string>;
}

const bus = { broker: undefined as DBusBroker | undefined, clients: [] as MessageBus[], calls: [] as string[] };

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

const note = (call: string) => () => {
  bus.calls.push(call);
};

/** A stand-in for BlueZ: it owns org.bluez and notes what it is asked. */
async function fakeBluez(options: { refusesPair?: boolean } = {}): Promise<MessageBus> {
  const bluez = await client();
  await bluez.ownName('org.bluez');
  await bluez.export(
    '/org/bluez',
    defineInterface({
      name: 'org.bluez.AgentManager1',
      methods: {
        RegisterAgent: {
          in: { path: 'o', capability: 's' },
          handler: ({ path, capability }: { path: string; capability: string }) => {
            bus.calls.push(`agent ${path} ${capability}`);
          }
        },
        RequestDefaultAgent: { in: { path: 'o' }, handler: note('default agent') },
        UnregisterAgent: { in: { path: 'o' }, handler: note('agent gone') }
      }
    })
  );
  await bluez.export(
    '/org/bluez/hci0',
    defineInterface({
      name: 'org.bluez.Adapter1',
      properties: {
        Alias: {
          type: 's',
          get: () => 'the-max-mix-2',
          set: value => {
            bus.calls.push(`alias ${String(value)}`);
          }
        }
      },
      methods: {
        SetDiscoveryFilter: {
          in: { filter: 'a{sv}' },
          handler: ({ filter }: { filter: Record<string, unknown> }) => {
            bus.calls.push(`filter ${String(filter['Transport'])}`);
          }
        },
        StartDiscovery: { handler: note('scan') },
        StopDiscovery: { handler: note('stop scan') }
      }
    })
  );
  await bluez.export(
    PHONE,
    defineInterface({
      name: 'org.bluez.Device1',
      methods: {
        Pair: {
          handler: () => {
            bus.calls.push('pair');
            if (options.refusesPair) throw new Error('Authentication Failed');
          }
        }
      }
    })
  );
  return bluez;
}

beforeEach(async () => {
  bus.calls = [];
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

describe('kiosk-audio/phone-discovery', () => {
  it('names the kiosk, registers its agent, scans Classic and LE, and stops scanning before it pairs', async () => {
    await fakeBluez();
    const discovery = await discoverPhones(() => null, await client());
    expect(bus.calls).toEqual([
      'alias THE MAX MIX',
      `agent ${AGENT} KeyboardDisplay`,
      'default agent',
      'filter auto',
      'scan'
    ]);
    await discovery.pair(PHONE);
    expect(bus.calls.slice(5)).toEqual(['stop scan', 'pair']);
    await discovery.stop();
    await discovery.stop();
    expect(bus.calls.slice(7)).toEqual(['agent gone']);
  });

  it('rejects when the phone does not pair', async () => {
    await fakeBluez({ refusesPair: true });
    const discovery = await discoverPhones(() => null, await client());
    await expect(discovery.pair(PHONE)).rejects.toThrow();
    await discovery.stop();
  });

  it('confirms the code the phone shows, passes it on, and turns down being asked to type one', async () => {
    const bluez = await fakeBluez();
    const owner = await client();
    const codes: number[] = [];
    const discovery = await discoverPhones(code => {
      codes.push(code);
    }, owner);
    const agent = (await bluez.proxy(owner.name ?? '', AGENT, { interface: 'org.bluez.Agent1' })) as unknown as Agent;
    await expect(agent.RequestConfirmation(PHONE, 287_389)).resolves.toBeUndefined();
    expect(codes).toEqual([287_389]);
    await expect(agent.RequestPinCode(PHONE)).rejects.toMatchObject({ dbusName: 'org.bluez.Error.Rejected' });
    await discovery.stop();
  });

  it('names the kiosk THE MAX MIX on its own', async () => {
    await fakeBluez();
    await nameKiosk(await client());
    expect(bus.calls).toEqual(['alias THE MAX MIX']);
  });

  it('rejects naming the kiosk when there is no adapter', async () => {
    await (await client()).ownName('org.bluez');
    await expect(nameKiosk(await client())).rejects.toThrow();
  });

  it('takes everything down again when BlueZ refuses', async () => {
    await (await client()).ownName('org.bluez');
    await expect(discoverPhones(() => null, await client())).rejects.toThrow('Bluetooth would not look for phones.');
  });
});
