// Who is home: whether the Pi hears each phone "Pair my phone" saved (phones.json). An iPhone keeps sending short
// Bluetooth LE adverts, locked or not, from an address that changes every few minutes; the identity key it gave the Pi
// when it paired lets BlueZ tell those adverts are that phone's, and bluetooth-monitor.ts notes when each paired
// device was last heard. BlueZ only hears adverts while it scans, and only the person switcher needs to know, so the
// Pi scans LE only while the app watches (the switcher is open, POST /bluetooth/presence), for two minutes at most,
// and never with no phone saved. A phone is "here" when it is connected or was heard in the last two minutes.
// For the first 8 seconds of a watch a phone not heard yet may just not have advertised yet, so the status says so.
//
// A phone is known by the fixed address it paired under (phone-pairing.ts) and keeps the name it was picked by: BlueZ's
// own name for it changes with whatever its adverts carry, so it is never read here.
import type { MessageBus } from 'dbus-native';
import { ignoreFailure, untilConnected } from './improv-gatt.ts';
import type { PairedPhone } from './phone-pairing.ts';

const ADAPTER = '/org/bluez/hci0';
const WATCH_MS = 2 * 60 * 1000;
const CHECKING_MS = 8000;
const AWAY_AFTER_MS = 2 * 60 * 1000;

interface PhonePresence {
  address: string;
  name: string;
  isHere: boolean;
  /** When the Pi last heard it (ms since 1970), or null. */
  lastSeen: number | null;
}

export interface PresenceStatus {
  /** Whether a watch began so lately that a phone not heard yet may still be heard. */
  isChecking: boolean;
  phones: PhonePresence[];
}

/** A paired device as bluetooth-monitor.ts reports it. */
interface HeardDevice {
  address: string;
  connected: boolean;
  lastSeen: number | null;
}

export interface PresenceOptions {
  phones: () => Promise<PairedPhone[]>;
  devices: () => Promise<HeardDevice[]>;
  /** Scans until `signal` aborts. */
  scan: (signal: AbortSignal) => Promise<void>;
  /** A line for the Bluetooth log in the debug console. */
  log: (message: string) => void;
  now?: () => number;
  watchMs?: number;
  checkingMs?: number;
  awayAfterMs?: number;
}

export class Presence {
  private readonly options: PresenceOptions;
  private readonly now: () => number;
  private current: PhonePresence[] = [];
  private scanning: AbortController | null = null;
  private watchStartedAt: number | null = null;
  private watchTimer: ReturnType<typeof setTimeout> | undefined;
  private hasScanFailed = false;

  constructor(options: PresenceOptions) {
    this.options = options;
    this.now = options.now ?? (() => Date.now());
  }

  private async scan(controller: AbortController): Promise<void> {
    try {
      if ((await this.options.phones()).length === 0) return;
      // Asking first starts the monitor watching, so it hears what the scan finds.
      await this.options.devices();
      if (controller.signal.aborted) return;
      await this.options.scan(controller.signal);
      this.hasScanFailed = false;
    } catch (error) {
      // Logged once, not on every watch.
      if (!this.hasScanFailed) this.options.log(`Presence: scan failed: ${String(error)}`);
      this.hasScanFailed = true;
    } finally {
      if (this.scanning === controller) this.scanning = null;
    }
  }

  /** Scans (when a phone is saved) for two minutes, or until `unwatch`. Asking again restarts the two minutes. */
  watch(): void {
    this.watchStartedAt ??= this.now();
    clearTimeout(this.watchTimer);
    this.watchTimer = setTimeout(() => {
      this.unwatch();
    }, this.options.watchMs ?? WATCH_MS);
    if (this.scanning) return;
    const controller = new AbortController();
    this.scanning = controller;
    void this.scan(controller);
  }

  unwatch(): void {
    clearTimeout(this.watchTimer);
    this.watchTimer = undefined;
    this.watchStartedAt = null;
    this.scanning?.abort();
    this.scanning = null;
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

  /** Who is here now; when BlueZ cannot say, what was last known. */
  async status(): Promise<PresenceStatus> {
    try {
      const saved = await this.options.phones();
      this.update(saved, saved.length > 0 ? await this.options.devices() : []);
    } catch (error) {
      this.options.log(`Presence: ${String(error)}`);
    }
    const startedAt = this.watchStartedAt;
    const isChecking = startedAt !== null && this.now() - startedAt < (this.options.checkingMs ?? CHECKING_MS);
    return { isChecking, phones: this.current };
  }
}

/** Scans for Bluetooth LE adverts on the system bus (`given` in the tests) until `signal` aborts, or fails. */
export async function scanLe(signal: AbortSignal, given?: MessageBus): Promise<void> {
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
    if (!signal.aborted) {
      await new Promise<void>(resolve => {
        signal.addEventListener(
          'abort',
          () => {
            resolve();
          },
          { once: true }
        );
      });
    }
    await call('StopDiscovery');
  } finally {
    // Closing also ends this client's discovery, if StopDiscovery did not run.
    await ignoreFailure(bus.close());
  }
}
