// Who is home: whether the Pi has heard each phone "Pair my phone" saved (phones.json) lately. An iPhone keeps sending
// short Bluetooth LE adverts, locked or not, from an address that changes every few minutes; the identity key it gave the
// Pi when it paired lets BlueZ tell those adverts are that phone's, and bluetooth-monitor.ts notes when each paired
// device was last heard. BlueZ only hears adverts while it scans, so every 30 seconds this scans LE for 8 seconds. With
// no phone saved it never scans. A phone is "here" when it is connected or was heard in the last two minutes.
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
  name: string;
  connected: boolean;
  lastSeen: number | null;
}

export interface PresenceOptions {
  phones: () => Promise<PairedPhone[]>;
  devices: () => Promise<HeardDevice[]>;
  /** Scans for `ms`, then stops. */
  scan: (ms: number) => Promise<void>;
  /** A line for the Bluetooth log in the debug console. */
  log: (message: string) => void;
  now?: () => number;
  everyMs?: number;
  burstMs?: number;
  awayAfterMs?: number;
}

export class Presence {
  private readonly options: PresenceOptions;
  private readonly now: () => number;
  private current: PhonePresence[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private isChecking = false;
  private hasScanFailed = false;

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
      return { address: phone.address, name: device?.name || phone.name, isHere, lastSeen };
    });
    for (const phone of this.current) {
      if (before.get(phone.address) !== phone.isHere) {
        this.options.log(`Presence: ${phone.name} is ${phone.isHere ? 'here' : 'away'}`);
      }
    }
  }

  /** Scans once (when a phone is saved) and works out who is here. */
  async check(): Promise<void> {
    if (this.isChecking) return;
    this.isChecking = true;
    try {
      const phones = await this.options.phones();
      if (phones.length > 0) {
        // Asking first starts the monitor watching, so it hears what the scan finds.
        await this.options.devices();
        await this.scan();
      }
      this.update(phones, phones.length > 0 ? await this.options.devices() : []);
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
