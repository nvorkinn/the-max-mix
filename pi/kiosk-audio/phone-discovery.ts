// The Bluetooth side of pairing a phone (phone-pairing.ts): the kiosk looks for phones, and pairs with the one picked on
// screen. With Settings > Bluetooth open, an iPhone is discoverable over Classic Bluetooth under its fixed public address
// and its own name ("Nikolai's iPhone"). The kiosk scans Classic and LE together, lists what it hears (the monitor,
// bluetooth-monitor.ts), and when one is picked stops scanning and asks BlueZ to pair. The phone asks its person to
// confirm a code; an agent registered here says yes on the kiosk's side (the person picked their phone on the kiosk,
// which is the check) and passes the code on to show. A Classic pairing also gives BlueZ the phone's LE identity key,
// so presence.ts can tell its changing LE adverts are that phone. Checked on the Pi with pi/tools/bt-probe.mts.
import type * as DBus from 'dbus-native';
import type { MessageBus } from 'dbus-native';
import { ignoreFailure, untilConnected } from './system-bus.ts';

const ADAPTER = '/org/bluez/hci0';
const AGENT = '/org/themaxmix/pairing_agent';
const LOCAL_NAME = 'THE MAX MIX';
/** How long BlueZ may take to pair, including the person reading the code and tapping Pair. */
const PAIR_TIMEOUT_MS = 90_000;

export interface PhoneDiscovery {
  /**
   * Stops scanning and pairs with the device at D-Bus `path`; rejects when it does not pair. `onConfirmed` is called
   * once the code is confirmed on the phone, a few seconds before BlueZ has finished pairing.
   */
  pair: (path: string, onConfirmed: () => void) => Promise<void>;
  /** Stops scanning and takes the agent away; safe to call more than once. */
  stop: () => Promise<void>;
}

const nothing = (): null => null;

/** BlueZ's answer to a request the agent turns down. */
class Rejected extends Error {
  readonly dbusName = 'org.bluez.Error.Rejected';
}
const reject = (): never => {
  throw new Rejected('THE MAX MIX only pairs by confirming a code on the phone.');
};

function agent(dbus: typeof DBus, onCode: (code: number) => void): ReturnType<typeof DBus.defineInterface> {
  return dbus.defineInterface({
    name: 'org.bluez.Agent1',
    methods: {
      Release: nothing,
      // The phone shows the same code and asks its person to tap Pair.
      RequestConfirmation: {
        in: { device: 'o', passkey: 'u' },
        handler: ({ passkey }: { passkey: number }) => {
          onCode(passkey);
          return null;
        }
      },
      RequestAuthorization: { in: { device: 'o' }, handler: nothing },
      AuthorizeService: { in: { device: 'o', uuid: 's' }, handler: nothing },
      // Nothing is typed on the kiosk.
      RequestPinCode: { in: { device: 'o' }, out: { pinCode: 's' }, handler: reject },
      RequestPasskey: { in: { device: 'o' }, out: { passkey: 'u' }, handler: reject },
      DisplayPinCode: { in: { device: 'o', pinCode: 's' }, handler: nothing },
      DisplayPasskey: { in: { device: 'o', passkey: 'u', entered: 'q' }, handler: nothing },
      Cancel: nothing
    }
  });
}

function call(
  bus: MessageBus,
  path: string,
  iface: string,
  member: string,
  args: { signature?: string; body?: unknown[] } = {},
  timeout?: number
) {
  return bus.invoke(
    { destination: 'org.bluez', path, interface: iface, member, ...args },
    timeout === undefined ? undefined : { timeout }
  );
}

/** Sets the adapter's Alias, the name a phone shows when the kiosk asks to pair, to THE MAX MIX. */
function setAlias(bus: MessageBus, dbus: typeof DBus) {
  return call(bus, ADAPTER, 'org.freedesktop.DBus.Properties', 'Set', {
    signature: 'ssv',
    body: ['org.bluez.Adapter1', 'Alias', new dbus.Variant('s', LOCAL_NAME)]
  });
}

/**
 * Names the kiosk THE MAX MIX in Bluetooth (BlueZ otherwise takes the hostname, the-max-mix-2, and keeps the Alias
 * across restarts). Rejects when BlueZ does not take it. `given` is the system bus; the tests pass another.
 */
export async function nameKiosk(given?: MessageBus): Promise<void> {
  const dbus = await import('dbus-native');
  const bus = given ?? dbus.systemBus();
  try {
    await untilConnected(bus);
    await setAlias(bus, dbus);
  } finally {
    await ignoreFailure(bus.close());
  }
}

/**
 * Calls `onBonded` when the device at `path` turns Bonded, which BlueZ (5.82 on the Pi) reports as soon as the phone's
 * person confirms the code: on the Pi that came about 5 s before Paired, which waits for the phone's services to be
 * read. Undefined when BlueZ cannot be watched; pairing goes on without it.
 */
async function watchBonded(
  bus: MessageBus,
  path: string,
  onBonded: () => void
): Promise<{ remove: () => Promise<void> } | undefined> {
  let isBonded = false;
  try {
    const properties = await bus.proxy('org.bluez', path, { interface: 'org.freedesktop.DBus.Properties' });
    return await properties.$watch('PropertiesChanged', (iface: string, changed: Record<string, unknown>) => {
      if (isBonded || iface !== 'org.bluez.Device1' || changed['Bonded'] !== true) return;
      isBonded = true;
      onBonded();
    });
  } catch (error) {
    console.warn(`bluetooth: cannot watch pairing: ${String(error)}`);
    return undefined;
  }
}

/**
 * Scans Classic and LE until `pair` or `stop`, with an agent that confirms the pairing and hands its code to `onCode`.
 * Rejects when BlueZ does not take it (no Bluetooth, or no permission). `given` is the system bus; the tests pass another.
 */
export async function discoverPhones(onCode: (code: number) => void, given?: MessageBus): Promise<PhoneDiscovery> {
  const dbus = await import('dbus-native');
  const bus = given ?? dbus.systemBus();
  await untilConnected(bus);
  const adapter = (member: string, args: { signature?: string; body?: unknown[] } = {}) =>
    call(bus, ADAPTER, 'org.bluez.Adapter1', member, args);
  let registration: { remove: () => Promise<unknown> } | undefined;
  let isScanning = false;
  let isStopped = false;

  const stopScanning = async (): Promise<void> => {
    if (!isScanning) return;
    isScanning = false;
    await ignoreFailure(adapter('StopDiscovery'));
  };

  const stop = async (): Promise<void> => {
    if (isStopped) return;
    isStopped = true;
    await stopScanning();
    await ignoreFailure(
      call(bus, '/org/bluez', 'org.bluez.AgentManager1', 'UnregisterAgent', { signature: 'o', body: [AGENT] })
    );
    if (registration) await ignoreFailure(registration.remove());
    await ignoreFailure(bus.close());
  };

  try {
    // Named at start-up too (server.ts), but a Pi whose Bluetooth came up late may only be named now.
    await ignoreFailure(setAlias(bus, dbus));
    registration = await bus.export(AGENT, agent(dbus, onCode));
    await call(bus, '/org/bluez', 'org.bluez.AgentManager1', 'RegisterAgent', {
      signature: 'os',
      body: [AGENT, 'KeyboardDisplay']
    });
    await call(bus, '/org/bluez', 'org.bluez.AgentManager1', 'RequestDefaultAgent', { signature: 'o', body: [AGENT] });
    await adapter('SetDiscoveryFilter', {
      signature: 'a{sv}',
      body: [{ Transport: new dbus.Variant('s', 'auto'), DuplicateData: new dbus.Variant('b', true) }]
    });
    await adapter('StartDiscovery');
    isScanning = true;
  } catch (error) {
    await stop();
    throw new Error('Bluetooth would not look for phones.', { cause: error });
  }

  return {
    pair: async (path: string, onConfirmed: () => void) => {
      // BlueZ pairs more reliably with nothing else on the radio.
      await stopScanning();
      const watch = await watchBonded(bus, path, onConfirmed);
      try {
        await call(bus, path, 'org.bluez.Device1', 'Pair', {}, PAIR_TIMEOUT_MS);
      } finally {
        if (watch) await ignoreFailure(watch.remove());
      }
    },
    stop
  };
}
