// The Bluetooth side of "Pair my phone" (phone-pairing.ts): for a couple of minutes the kiosk shows up on a phone as a
// keyboard called THE MAX MIX (the advert's name, and the adapter's Alias, which is what an iPhone lists). An iPhone only offers to pair, in Settings > Bluetooth, with a few kinds of device, and a
// keyboard is one it does not need an app for. Its service's values can only be read over an encrypted link, so reading
// them makes the phone pair, and pairing gives the Pi the phone's identity key: from then on BlueZ knows the phone's
// changing addresses as that one device. No key presses are ever sent. An agent says yes to the pairing while this runs
// (the person pressed the button on the kiosk and taps Pair on their phone, which is the check).
//
// D-Bus objects as in improv-gatt.ts: a GATT application and an advertisement registered with BlueZ's managers on hci0,
// and an agent registered with the agent manager.
import type * as DBus from 'dbus-native';
import type { InterfaceDefinition, MessageBus } from 'dbus-native';
import { ignoreFailure, untilConnected } from './improv-gatt.ts';

const APP = '/org/themaxmix/pairing';
const SERVICE = `${APP}/service0`;
const ADVERTISEMENT = '/org/themaxmix/pairing_adv';
const AGENT = '/org/themaxmix/pairing_agent';
const ADAPTER = '/org/bluez/hci0';
const LOCAL_NAME = 'THE MAX MIX';
/** The Bluetooth appearance of a keyboard (HID, 0x03C1). */
const KEYBOARD_APPEARANCE = 0x03_c1;
const CHARACTERISTIC = 'org.bluez.GattCharacteristic1';
const DESCRIPTOR = 'org.bluez.GattDescriptor1';

const uuid16 = (short: string) => `0000${short}-0000-1000-8000-00805f9b34fb`;
export const HID_SERVICE = uuid16('1812');

/** A boot keyboard's report map: eight modifier bits, a reserved byte and six key codes in, five LEDs out. */
const REPORT_MAP = Uint8Array.from([
  0x05, 0x01, 0x09, 0x06, 0xa1, 0x01, 0x85, 0x01, 0x05, 0x07, 0x19, 0xe0, 0x29, 0xe7, 0x15, 0x00, 0x25, 0x01, 0x75,
  0x01, 0x95, 0x08, 0x81, 0x02, 0x95, 0x01, 0x75, 0x08, 0x81, 0x01, 0x95, 0x05, 0x75, 0x01, 0x05, 0x08, 0x19, 0x01,
  0x29, 0x05, 0x91, 0x02, 0x95, 0x01, 0x75, 0x03, 0x91, 0x01, 0x95, 0x06, 0x75, 0x08, 0x15, 0x00, 0x25, 0x65, 0x05,
  0x07, 0x19, 0x00, 0x29, 0x65, 0x81, 0x00, 0xc0
]);

/** The keyboard's characteristics: HID information, the report map, the control point, protocol mode and one report. */
export const CHARACTERISTICS = [
  // HID 1.11, no country code, may wake the host.
  { uuid: uuid16('2a4a'), flags: ['encrypt-read'], value: Uint8Array.from([0x11, 0x01, 0x00, 0x02]) },
  { uuid: uuid16('2a4b'), flags: ['encrypt-read'], value: REPORT_MAP },
  { uuid: uuid16('2a4c'), flags: ['encrypt-write', 'write-without-response'], value: Uint8Array.of(0) },
  // Report protocol.
  { uuid: uuid16('2a4e'), flags: ['encrypt-read', 'write-without-response'], value: Uint8Array.of(1) },
  // The input report, never sent: no key is ever pressed.
  { uuid: uuid16('2a4d'), flags: ['encrypt-read', 'notify'], value: new Uint8Array(8) }
] as const;
const REPORT_INDEX = 4;
/** The report's reference: report ID 1, an input report. */
const REPORT_REFERENCE = { uuid: uuid16('2908'), value: Uint8Array.from([0x01, 0x01]) };

export interface PairingAdvertising {
  /** Stops advertising, takes the keyboard and the agent away; safe to call more than once. */
  stop: () => Promise<void>;
}

const nothing = (): null => null;

/** BlueZ's answer to a pairing request the agent turns down. */
class Rejected extends Error {
  readonly dbusName = 'org.bluez.Error.Rejected';
}
const reject = (): never => {
  throw new Rejected('THE MAX MIX only pairs by tapping Pair.');
};

function agent(dbus: typeof DBus): ReturnType<typeof DBus.defineInterface> {
  return dbus.defineInterface({
    name: 'org.bluez.Agent1',
    methods: {
      Release: nothing,
      // Just Works: the phone shows Pair, and BlueZ asks the agent to confirm or authorise it.
      RequestConfirmation: { in: { device: 'o', passkey: 'u' }, handler: nothing },
      RequestAuthorization: { in: { device: 'o' }, handler: nothing },
      AuthorizeService: { in: { device: 'o', uuid: 's' }, handler: nothing },
      // No codes are typed on the kiosk.
      RequestPinCode: { in: { device: 'o' }, out: { pinCode: 's' }, handler: reject },
      RequestPasskey: { in: { device: 'o' }, out: { passkey: 'u' }, handler: reject },
      DisplayPinCode: { in: { device: 'o', pinCode: 's' }, handler: nothing },
      DisplayPasskey: { in: { device: 'o', passkey: 'u', entered: 'q' }, handler: nothing },
      Cancel: nothing
    }
  });
}

function characteristic(
  dbus: typeof DBus,
  spec: { uuid: string; flags: readonly string[]; value: Uint8Array }
): ReturnType<typeof DBus.defineInterface> {
  const methods: NonNullable<InterfaceDefinition['methods']> = {
    ReadValue: { in: { options: 'a{sv}' }, out: { value: 'ay' }, handler: () => Buffer.from(spec.value) },
    WriteValue: { in: { value: 'ay', options: 'a{sv}' }, handler: nothing },
    StartNotify: nothing,
    StopNotify: nothing
  };
  return dbus.defineInterface({
    name: CHARACTERISTIC,
    properties: {
      UUID: { type: 's', access: 'read', value: spec.uuid },
      Service: { type: 'o', access: 'read', value: SERVICE },
      Flags: { type: 'as', access: 'read', value: [...spec.flags] }
    },
    methods
  });
}

function call(
  bus: MessageBus,
  path: string,
  iface: string,
  member: string,
  args: { signature: string; body: unknown[] }
) {
  return bus.invoke({ destination: 'org.bluez', path, interface: iface, member, ...args });
}

/**
 * Shows the kiosk as a keyboard to phones nearby and says yes to their pairing, until `stop`. Rejects with an Error when
 * BlueZ does not take it (no Bluetooth, or no permission). `given` is the system bus; the tests pass another.
 */
export async function advertiseForPairing(given?: MessageBus): Promise<PairingAdvertising> {
  const dbus = await import('dbus-native');
  const bus = given ?? dbus.systemBus();
  await untilConnected(bus);
  const removers: (() => Promise<void>)[] = [];
  const exportObject = async (path: string, definition: ReturnType<typeof DBus.defineInterface>): Promise<void> => {
    const registration = await bus.export(path, definition);
    removers.push(() => registration.remove());
  };

  const stop = async (): Promise<void> => {
    const pending = removers.splice(0);
    const unregister = (iface: string, member: string, path: string, at = ADAPTER) =>
      ignoreFailure(call(bus, at, iface, member, { signature: 'o', body: [path] }));
    await unregister('org.bluez.LEAdvertisingManager1', 'UnregisterAdvertisement', ADVERTISEMENT);
    await unregister('org.bluez.GattManager1', 'UnregisterApplication', APP);
    await unregister('org.bluez.AgentManager1', 'UnregisterAgent', AGENT, '/org/bluez');
    for (const remove of pending.toReversed()) {
      // One object at a time, in the reverse of the order they were made.
      // eslint-disable-next-line no-await-in-loop
      await ignoreFailure(remove());
    }
    await ignoreFailure(bus.close());
  };

  const exportAll = async (): Promise<void> => {
    // A phone lists the kiosk by the adapter's own name, which BlueZ otherwise takes from the hostname (the-max-mix-2),
    // not by the advert's LocalName. BlueZ keeps the Alias, so this names the kiosk for good.
    try {
      await call(bus, ADAPTER, 'org.freedesktop.DBus.Properties', 'Set', {
        signature: 'ssv',
        body: ['org.bluez.Adapter1', 'Alias', new dbus.Variant('s', LOCAL_NAME)]
      });
    } catch (error) {
      console.warn(`bluetooth: could not name the kiosk ${LOCAL_NAME}: ${String(error)}`);
    }
    await exportObject(AGENT, agent(dbus));
    await call(bus, '/org/bluez', 'org.bluez.AgentManager1', 'RegisterAgent', {
      signature: 'os',
      body: [AGENT, 'NoInputNoOutput']
    });
    await call(bus, '/org/bluez', 'org.bluez.AgentManager1', 'RequestDefaultAgent', { signature: 'o', body: [AGENT] });

    bus.exportObjectManager(APP);
    const service = dbus.defineInterface({
      name: 'org.bluez.GattService1',
      properties: {
        UUID: { type: 's', access: 'read', value: HID_SERVICE },
        Primary: { type: 'b', access: 'read', value: true }
      }
    });
    await exportObject(SERVICE, service);
    for (const [index, spec] of CHARACTERISTICS.entries()) {
      // BlueZ reads the objects in order, so they are made in order.
      // eslint-disable-next-line no-await-in-loop
      await exportObject(`${SERVICE}/char${index}`, characteristic(dbus, spec));
    }
    const reference = dbus.defineInterface({
      name: DESCRIPTOR,
      properties: {
        UUID: { type: 's', access: 'read', value: REPORT_REFERENCE.uuid },
        Characteristic: { type: 'o', access: 'read', value: `${SERVICE}/char${REPORT_INDEX}` },
        Flags: { type: 'as', access: 'read', value: ['encrypt-read'] }
      },
      methods: {
        ReadValue: {
          in: { options: 'a{sv}' },
          out: { value: 'ay' },
          handler: () => Buffer.from(REPORT_REFERENCE.value)
        }
      }
    });
    await exportObject(`${SERVICE}/char${REPORT_INDEX}/desc0`, reference);

    const advertisement = dbus.defineInterface({
      name: 'org.bluez.LEAdvertisement1',
      properties: {
        Type: { type: 's', access: 'read', value: 'peripheral' },
        ServiceUUIDs: { type: 'as', access: 'read', value: [HID_SERVICE] },
        Appearance: { type: 'q', access: 'read', value: KEYBOARD_APPEARANCE },
        LocalName: { type: 's', access: 'read', value: LOCAL_NAME },
        Discoverable: { type: 'b', access: 'read', value: true }
      },
      methods: { Release: nothing }
    });
    await exportObject(ADVERTISEMENT, advertisement);
    await call(bus, ADAPTER, 'org.bluez.GattManager1', 'RegisterApplication', { signature: 'oa{sv}', body: [APP, {}] });
    await call(bus, ADAPTER, 'org.bluez.LEAdvertisingManager1', 'RegisterAdvertisement', {
      signature: 'oa{sv}',
      body: [ADVERTISEMENT, {}]
    });
  };

  try {
    await exportAll();
  } catch (error) {
    await stop();
    throw new Error('Bluetooth would not start pairing.', { cause: error });
  }
  return { stop };
}
