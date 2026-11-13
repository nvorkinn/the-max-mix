// Who is home: whether the Pi has heard each phone "Pair my phone" saved (phones.json) lately. An iPhone keeps sending
// short Bluetooth LE adverts, locked or not, from an address that changes every few minutes; the identity key it gave the
// Pi when it paired lets BlueZ tell those adverts are that phone's, and bluetooth-monitor.ts notes when each paired
// device was last heard. BlueZ only hears adverts while it scans, so every 30 seconds this scans LE for 8 seconds. With
// no phone saved it never scans. A phone is "here" when it is connected or was heard in the last two minutes.
//
// BlueZ renames a device to whatever name its latest advert or scan response carries, and an iPhone's can be anything an
// app on it advertises (one showed up as "4"). So a phone keeps its saved name: when BlueZ's differs, the device's Alias,
// which BlueZ keeps and shows in place of the name, is set back to it. An iPhone only says "iPhone" before it is paired,
// so the saved name may be that, and its full name ("Nikolai's iPhone") turns up later. The saved name changes to a new
// one the phone gives while it is connected (its own device name), to one that adds to the saved name ("iPhone" to
// "Nikolai's iPhone"), and, for a phone saved under its address, to the first name heard; never to an unrelated advert's.
// BlueZ names a device's D-Bus object after the address it first heard, which for a phone is a passing random one, so
// the object is looked up (bluetooth-monitor.ts reports it) rather than worked out from the address.
import type { MessageBus } from 'dbus-native';
import { ignoreFailure, untilConnected } from './improv-gatt.ts';
import type { PairedPhone } from './phone-pairing.ts';

const ADAPTER = '/org/bluez/hci0';
const EVERY_MS = 30_000;
const BURST_MS = 8000;
const AWAY_AFTER_MS = 2 * 60 * 1000;

export interface PhonePresence {
  address: string;
  name: string;
  isHere: boolean;
  /** When the Pi last heard it (ms since 1970), or null. */
  lastSeen: number | null;
}

/** A paired device as bluetooth-monitor.ts reports it. */
interface HeardDevice {
  address: string;
  /** What BlueZ shows (its Alias). */
  name: string;
  /** The name the device last gave BlueZ, or "". */
  bluezName: string;
  /** BlueZ's D-Bus object for it. */
  path: string;
  connected: boolean;
  lastSeen: number | null;
}

export interface PresenceOptions {
  phones: () => Promise<PairedPhone[]>;
  devices: () => Promise<HeardDevice[]>;
  /** Scans for `ms`, then stops. */
  scan: (ms: number) => Promise<void>;
  /** Sets the name BlueZ shows for the device at a D-Bus object path. */
  rename: (path: string, name: string) => Promise<void>;
  /** Saves a phone's new name (phones.json). */
  saveName: (address: string, name: string) => Promise<void>;
  /** A line for the Bluetooth log in the debug console. */
  log: (message: string) => void;
  now?: () => number;
  everyMs?: number;
  burstMs?: number;
  awayAfterMs?: number;
}

/** Whether `name` is only an address, which BlueZ shows until it hears a name. */
const isAddress = (name: string): boolean => {
  const parts = name.split(/[:-]/);
  return parts.length === 6 && parts.every(part => /^[\dA-F]{2}$/i.test(part));
};

export class Presence {
  private readonly options: PresenceOptions;
  private readonly now: () => number;
  private current: PhonePresence[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private isChecking = false;
  private hasScanFailed = false;
  /** Phones whose rename failed, so it is logged and tried once. */
  private readonly renameFailed = new Set<string>();

  constructor(options: PresenceOptions) {
    this.options = options;
    this.now = options.now ?? (() => Date.now());
  }

  private async scan(): Promise<void> {
    try {
      await this.options.scan(this.options.burstMs ?? BURST_MS);
      this.hasScanFailed = false;
    } catch (error) {
      // Logged once, not every 30 seconds.
      if (!this.hasScanFailed) this.options.log(`Presence: scan failed: ${String(error)}`);
      this.hasScanFailed = true;
    }
  }

  private update(phones: PairedPhone[], devices: HeardDevice[]): void {
    const awayAfterMs = this.options.awayAfterMs ?? AWAY_AFTER_MS;
    const before = new Map(this.current.map(phone => [phone.address, phone.isHere]));
    this.current = phones.map(phone => {
      const device = devices.find(known => known.address === phone.address);
      const lastSeen = device?.lastSeen ?? null;
      const isHere = Boolean(device?.connected) || (lastSeen !== null && this.now() - lastSeen < awayAfterMs);
      return { address: phone.address, name: phone.name, isHere, lastSeen };
    });
    for (const phone of this.current) {
      if (before.get(phone.address) !== phone.isHere) {
        this.options.log(`Presence: ${phone.name} is ${phone.isHere ? 'here' : 'away'}`);
      }
    }
  }

  /**
   * Saves the name a phone gave over a connection (its own), one that adds to the saved name, or the first name heard
   * for a phone saved under its address. Returns the phones with their names as saved now.
   */
  private async learnNames(phones: PairedPhone[], devices: HeardDevice[]): Promise<PairedPhone[]> {
    const learned: PairedPhone[] = [];
    for (const phone of phones) {
      const device = devices.find(known => known.address === phone.address);
      const name = device?.bluezName ?? '';
      const isOwnName =
        Boolean(device?.connected) ||
        isAddress(phone.name) ||
        (name.length > phone.name.length && name.toLowerCase().includes(phone.name.toLowerCase()));
      if (!name || !isOwnName || name === phone.name || isAddress(name)) {
        learned.push(phone);
        continue;
      }
      try {
        // One at a time: there is rarely more than one, and the file is small.
        // eslint-disable-next-line no-await-in-loop
        await this.options.saveName(phone.address, name);
        this.options.log(`Presence: ${phone.name} is called ${name}`);
        learned.push({ ...phone, name });
      } catch (error) {
        this.options.log(`Presence: could not save ${name}: ${String(error)}`);
        learned.push(phone);
      }
    }
    return learned;
  }

  /** Sets BlueZ's name for each saved phone back to the saved one, where it has changed. */
  private async keepNames(phones: PairedPhone[], devices: HeardDevice[]): Promise<void> {
    for (const phone of phones) {
      const device = devices.find(known => known.address === phone.address);
      if (!device || !phone.name || device.name === phone.name || this.renameFailed.has(phone.address)) continue;
      try {
        // One at a time: there is rarely more than one, and BlueZ answers quickly.
        // eslint-disable-next-line no-await-in-loop
        await this.options.rename(device.path, phone.name);
        this.options.log(`Presence: ${device.name} named ${phone.name} again`);
      } catch (error) {
        this.renameFailed.add(phone.address);
        this.options.log(`Presence: could not name ${device.name} ${phone.name}: ${String(error)}`);
      }
    }
  }

  /** Scans once (when a phone is saved) and works out who is here. */
  async check(): Promise<void> {
    if (this.isChecking) return;
    this.isChecking = true;
    try {
      const saved = await this.options.phones();
      if (saved.length > 0) {
        // Asking first starts the monitor watching, so it hears what the scan finds.
        await this.options.devices();
        await this.scan();
      }
      const devices = saved.length > 0 ? await this.options.devices() : [];
      const phones = await this.learnNames(saved, devices);
      this.update(phones, devices);
      await this.keepNames(phones, devices);
    } catch (error) {
      this.options.log(`Presence: ${String(error)}`);
    } finally {
      this.isChecking = false;
    }
  }

  /** Checks now and every 30 seconds. */
  start(): void {
    if (this.timer) return;
    void this.check();
    this.timer = setInterval(() => void this.check(), this.options.everyMs ?? EVERY_MS);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  status(): PhonePresence[] {
    return this.current;
  }
}

/** Scans for Bluetooth LE adverts for `ms` on the system bus (`given` in the tests); stops when done or on failure. */
export async function scanLe(ms: number, given?: MessageBus): Promise<void> {
  const dbus = await import('dbus-native');
  const bus = given ?? dbus.systemBus();
  const call = (member: string, args: { signature?: string; body?: unknown[] } = {}) =>
    bus.invoke({ destination: 'org.bluez', path: ADAPTER, interface: 'org.bluez.Adapter1', member, ...args });
  try {
    await untilConnected(bus);
    await call('SetDiscoveryFilter', {
      signature: 'a{sv}',
      body: [{ Transport: new dbus.Variant('s', 'le'), DuplicateData: new dbus.Variant('b', true) }]
    });
    await call('StartDiscovery');
    await new Promise(resolve => setTimeout(resolve, ms));
    await call('StopDiscovery');
  } finally {
    // Closing also ends this client's discovery, if StopDiscovery did not run.
    await ignoreFailure(bus.close());
  }
}

/** Sets the Alias BlueZ keeps and shows for the device at D-Bus `path`, on the system bus (`given` in the tests). */
export async function setAlias(path: string, name: string, given?: MessageBus): Promise<void> {
  const dbus = await import('dbus-native');
  const bus = given ?? dbus.systemBus();
  try {
    await untilConnected(bus);
    await bus.invoke({
      destination: 'org.bluez',
      path,
      interface: 'org.freedesktop.DBus.Properties',
      member: 'Set',
      signature: 'ssv',
      body: ['org.bluez.Device1', 'Alias', new dbus.Variant('s', name)]
    });
  } finally {
    await ignoreFailure(bus.close());
  }
}
