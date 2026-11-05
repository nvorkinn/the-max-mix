// The Bluetooth side of Improv Wi-Fi (improv.ts): a GATT service that BlueZ serves, and an advertisement that lets a
// phone find it. Both are D-Bus objects this process exports on the system bus; BlueZ is told about them with
// RegisterApplication and RegisterAdvertisement, and then calls ReadValue and WriteValue on them. The kiosk user is in
// the bluetooth group, which is what BlueZ's D-Bus policy needs. The first Bluetooth adapter is used (hci0).
import { defineInterface, systemBus, Variant } from 'dbus-native';
import type { InterfaceDefinition, MessageBus } from 'dbus-native';
import { CAPABILITIES, CHARACTERISTICS, SERVICE_UUID } from './improv.ts';
import type { ImprovSession } from './improv.ts';

const APP = '/org/themaxmix/improv';
const SERVICE = `${APP}/service0`;
// Outside APP, so BlueZ's object manager for the application does not list it.
const ADVERTISEMENT = '/org/themaxmix/improv_adv';
const ADAPTER = '/org/bluez/hci0';
const LOCAL_NAME = 'THE MAX MIX';
const CONNECT_WAIT_MS = 5000;
const GATT_MANAGER = 'org.bluez.GattManager1';
const ADVERTISING_MANAGER = 'org.bluez.LEAdvertisingManager1';
const CHARACTERISTIC = 'org.bluez.GattCharacteristic1';

export interface Advertising {
  /** Stops advertising and takes the service away; safe to call more than once. */
  stop: () => Promise<void>;
}

/** What a characteristic shows the phone when it reads it. */
interface Readable {
  path: string;
  uuid: string;
  read: () => Uint8Array;
  /** Whether the phone is told when it changes. */
  notifies: boolean;
}

/** Waits until the bus has said hello (it has a unique name), which BlueZ needs to call back. */
async function untilConnected(bus: MessageBus): Promise<void> {
  const deadline = Date.now() + CONNECT_WAIT_MS;
  while (!bus.name) {
    if (Date.now() > deadline) throw new Error('The system bus did not answer.');
    // A short poll for the hello reply.
    // eslint-disable-next-line no-await-in-loop
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

/** A call to BlueZ's adapter. */
function callAdapter(bus: MessageBus, iface: string, member: string, args: { signature: string; body: unknown[] }) {
  return bus.invoke({ destination: 'org.bluez', path: ADAPTER, interface: iface, member, ...args });
}

/** Waits for `work` and ignores how it ended: used to take things down, which may already be gone. */
async function ignoreFailure(work: PromiseLike<unknown>): Promise<void> {
  try {
    await work;
  } catch {
    // Already gone, or BlueZ stopped: nothing is left to undo.
  }
}

const nothing = (): null => null;

function characteristic(
  uuid: string,
  flags: string[],
  methods: NonNullable<InterfaceDefinition['methods']>
): ReturnType<typeof defineInterface> {
  return defineInterface({
    name: CHARACTERISTIC,
    properties: {
      UUID: { type: 's', access: 'read', value: uuid },
      Service: { type: 'o', access: 'read', value: SERVICE },
      Flags: { type: 'as', access: 'read', value: flags }
    },
    methods: { ...methods, StartNotify: nothing, StopNotify: nothing }
  });
}

/**
 * Advertises the Improv service and serves it from `session`, which is notified of what the phone writes. Rejects with an
 * Error when BlueZ does not take it (no Bluetooth, or no permission). `bus` is the system bus; the tests pass another.
 */
export async function advertise(session: ImprovSession, bus: MessageBus = systemBus()): Promise<Advertising> {
  await untilConnected(bus);
  const removers: (() => Promise<void>)[] = [];
  const exportObject = async (path: string, definition: ReturnType<typeof defineInterface>): Promise<void> => {
    const registration = await bus.export(path, definition);
    removers.push(() => registration.remove());
  };

  const readables: Readable[] = [
    { path: `${SERVICE}/char0`, uuid: CHARACTERISTICS.state, read: () => Uint8Array.of(session.state), notifies: true },
    { path: `${SERVICE}/char1`, uuid: CHARACTERISTICS.error, read: () => Uint8Array.of(session.error), notifies: true },
    { path: `${SERVICE}/char3`, uuid: CHARACTERISTICS.result, read: () => session.result, notifies: true },
    {
      path: `${SERVICE}/char4`,
      uuid: CHARACTERISTICS.capabilities,
      read: () => Uint8Array.of(CAPABILITIES),
      notifies: false
    }
  ];

  const stop = async (): Promise<void> => {
    const pending = removers.splice(0);
    await ignoreFailure(
      callAdapter(bus, ADVERTISING_MANAGER, 'UnregisterAdvertisement', { signature: 'o', body: [ADVERTISEMENT] })
    );
    await ignoreFailure(callAdapter(bus, GATT_MANAGER, 'UnregisterApplication', { signature: 'o', body: [APP] }));
    for (const remove of pending) {
      // One object at a time, in the reverse of the order they were made.
      // eslint-disable-next-line no-await-in-loop
      await ignoreFailure(remove());
    }
    await ignoreFailure(bus.close());
  };

  const exportAll = async (): Promise<void> => {
    bus.exportObjectManager(APP);
    const service = defineInterface({
      name: 'org.bluez.GattService1',
      properties: {
        UUID: { type: 's', access: 'read', value: SERVICE_UUID },
        Primary: { type: 'b', access: 'read', value: true }
      }
    });
    await exportObject(SERVICE, service);
    for (const { path, uuid, read, notifies } of readables) {
      const methods = {
        ReadValue: { in: { options: 'a{sv}' }, out: { value: 'ay' }, handler: () => Buffer.from(read()) }
      };
      // BlueZ reads the objects in order, so they are made in order.
      // eslint-disable-next-line no-await-in-loop
      await exportObject(path, characteristic(uuid, notifies ? ['read', 'notify'] : ['read'], methods));
    }
    const writeValue = {
      in: { value: 'ay', options: 'a{sv}' },
      handler: ({ value }: { value: Uint8Array }) => {
        void session.handle(new Uint8Array(value));
      }
    };
    await exportObject(
      `${SERVICE}/char2`,
      characteristic(CHARACTERISTICS.command, ['write'], { WriteValue: writeValue })
    );
    // The state and capabilities the protocol puts in the advertisement, then four reserved bytes.
    const serviceData = new Variant('ay', Buffer.from([session.state, CAPABILITIES, 0, 0, 0, 0]));
    const advertisement = defineInterface({
      name: 'org.bluez.LEAdvertisement1',
      properties: {
        Type: { type: 's', access: 'read', value: 'peripheral' },
        ServiceUUIDs: { type: 'as', access: 'read', value: [SERVICE_UUID] },
        LocalName: { type: 's', access: 'read', value: LOCAL_NAME },
        ServiceData: { type: 'a{sv}', access: 'read', value: { [SERVICE_UUID]: serviceData } }
      },
      methods: { Release: nothing }
    });
    await exportObject(ADVERTISEMENT, advertisement);
    await callAdapter(bus, GATT_MANAGER, 'RegisterApplication', { signature: 'oa{sv}', body: [APP, {}] });
    await callAdapter(bus, ADVERTISING_MANAGER, 'RegisterAdvertisement', {
      signature: 'oa{sv}',
      body: [ADVERTISEMENT, {}]
    });
  };

  try {
    await exportAll();
  } catch (error) {
    await stop();
    throw new Error('Bluetooth would not start the phone setup.', { cause: error });
  }

  // Tells the phone about each change, as BlueZ expects: a PropertiesChanged on the characteristic's Value.
  const unsubscribe = session.onChange(() => {
    for (const { path, read, notifies } of readables) {
      const value = read();
      if (!notifies || value.length === 0) continue;
      const changed = { Value: new Variant('ay', Buffer.from(value)) };
      bus.sendSignal(path, 'org.freedesktop.DBus.Properties', 'PropertiesChanged', 'sa{sv}as', [
        CHARACTERISTIC,
        changed,
        []
      ]);
    }
  });
  return {
    stop: async () => {
      unsubscribe();
      await stop();
    }
  };
}
