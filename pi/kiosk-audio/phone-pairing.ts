// Pairing a person's phone with the kiosk. While the pairing sheet (or the debug console's "Pair my phone") is open, the
// kiosk looks for phones for up to two minutes (phone-discovery.ts) and lists the ones it hears with a name. The person
// opens Settings > Bluetooth on their iPhone, which makes it show up under its own name, and taps it on the kiosk. The
// kiosk then pairs with it (the phone asks to confirm a code, shown on the kiosk too), notes it in phones.json next to
// speakers.json under its fixed address and the name it was picked by, and hangs up. That name is kept as it was picked:
// later adverts (an app on the phone can advertise as anything, "4" once) never change it. BlueZ keeps the phone's
// identity key, which is what lets presence.ts tell the phone is nearby even as its LE address changes.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PhoneDiscovery } from './phone-discovery.ts';

const WINDOW_MS = 2 * 60 * 1000;
const CHECK_MS = 1000;

export const PAIRING_ERRORS = {
  unavailable: 'Bluetooth is not available, so no phone can pair.',
  timedOut: 'No phone was picked within 2 minutes.',
  gone: 'That phone is no longer nearby. Keep Settings › Bluetooth open on it.',
  refused: 'The phone did not pair. Try again, and tap Pair on the phone.'
} as const;

export interface PairedPhone {
  address: string;
  name: string;
  /** When it paired, ms since 1970. */
  pairedAt: number;
}

/** A device heard nearby with a name, which may be a phone to pick. */
export interface NearbyDevice {
  address: string;
  name: string;
  /** BlueZ's D-Bus object for it, for pairing. */
  path: string;
}

export type PairingStatus =
  | { state: 'idle' }
  | { state: 'scanning'; secondsLeft: number; nearby: { address: string; name: string }[] }
  | { state: 'pairing'; name: string; code: number | null }
  | { state: 'paired'; phone: PairedPhone }
  | { state: 'failed'; error: string };

export interface PhonePairingOptions {
  /** Starts looking for phones; `onCode` gets the code the phone shows while pairing. */
  discover: (onCode: (code: number) => void) => Promise<PhoneDiscovery>;
  /** The unpaired devices heard lately with a name, phones first. */
  nearby: () => Promise<NearbyDevice[]>;
  disconnect: (address: string) => Promise<void>;
  save: (phone: PairedPhone) => Promise<void>;
  /** Drops a phone from the saved list. */
  forget: (address: string) => Promise<void>;
  /** A line for the Bluetooth log in the debug console. */
  log: (message: string) => void;
  now?: () => number;
  windowMs?: number;
  checkMs?: number;
}

export class PhonePairing {
  private readonly options: PhonePairingOptions;
  private readonly now: () => number;
  private current: PairingStatus = { state: 'idle' };
  private running:
    | {
        discovery: PhoneDiscovery;
        deadline: number;
        timer: ReturnType<typeof setInterval> | undefined;
        nearby: NearbyDevice[];
      }
    | undefined;
  private starting: Promise<void> | undefined;

  constructor(options: PhonePairingOptions) {
    this.options = options;
    this.now = options.now ?? (() => Date.now());
  }

  private isScanning(): boolean {
    return this.current.state === 'scanning';
  }

  private scanning(nearby: NearbyDevice[]): PairingStatus {
    const deadline = this.running?.deadline ?? this.now();
    return {
      state: 'scanning',
      secondsLeft: Math.max(0, Math.ceil((deadline - this.now()) / 1000)),
      nearby: nearby.map(({ address, name }) => ({ address, name }))
    };
  }

  private async begin(): Promise<void> {
    const windowMs = this.options.windowMs ?? WINDOW_MS;
    if (this.running) {
      // Already looking: two more minutes. Already pairing: let it finish.
      if (this.current.state === 'scanning') {
        this.running.deadline = this.now() + windowMs;
        this.options.log('Pairing: two more minutes');
      }
      return;
    }
    let discovery: PhoneDiscovery;
    try {
      discovery = await this.options.discover(code => {
        if (this.current.state === 'pairing') this.current = { ...this.current, code };
      });
    } catch (error) {
      console.warn(`bluetooth: pairing did not start: ${String(error)}`);
      this.current = { state: 'failed', error: PAIRING_ERRORS.unavailable };
      this.options.log('Pairing could not start');
      throw new Error(PAIRING_ERRORS.unavailable, { cause: error });
    }
    const timer = setInterval(() => void this.check(), this.options.checkMs ?? CHECK_MS);
    this.running = { discovery, deadline: this.now() + windowMs, timer, nearby: [] };
    this.current = this.scanning([]);
    this.options.log('Pairing: looking for phones');
  }

  /** Lists what is nearby, or gives up at the deadline. */
  private async check(): Promise<void> {
    const running = this.running;
    if (!running || !this.isScanning()) return;
    if (this.now() >= running.deadline) {
      await this.end({ state: 'failed', error: PAIRING_ERRORS.timedOut });
      this.options.log('Pairing: no phone picked in time');
      return;
    }
    try {
      running.nearby = await this.options.nearby();
    } catch (error) {
      console.warn(`bluetooth: pairing check failed: ${String(error)}`);
    }
    if (this.running === running && this.isScanning()) this.current = this.scanning(running.nearby);
  }

  /** Stops looking and settles on `status`. */
  private async end(status: PairingStatus): Promise<void> {
    const running = this.running;
    this.running = undefined;
    this.current = status;
    if (!running) return;
    clearInterval(running.timer);
    await running.discovery.stop();
  }

  /** Starts looking for phones, or gives the current look two more minutes. Rejects when Bluetooth would not. */
  async start(): Promise<void> {
    const pending = (this.starting ??= this.begin());
    try {
      await pending;
    } finally {
      if (this.starting === pending) this.starting = undefined;
    }
  }

  /**
   * Pairs with the device at `address` from the list, keeping the name it was listed under, then hangs up. Rejects when
   * nothing is being looked for or it is not in the list; how the pairing went is in the status.
   */
  async pick(address: string): Promise<void> {
    const running = this.running;
    const device = running?.nearby.find(known => known.address === address);
    if (!device || !running || !this.isScanning()) throw new Error(PAIRING_ERRORS.gone);
    clearInterval(running.timer);
    running.timer = undefined;
    this.current = { state: 'pairing', name: device.name, code: null };
    this.options.log(`Pairing: ${device.name} (${device.address})`);
    try {
      await running.discovery.pair(device.path);
    } catch (error) {
      console.warn(`bluetooth: pairing failed: ${String(error)}`);
      if (this.running === running) await this.end({ state: 'failed', error: PAIRING_ERRORS.refused });
      this.options.log(`Pairing: ${device.name} did not pair`);
      return;
    }
    const phone = { address: device.address, name: device.name, pairedAt: this.now() };
    try {
      await this.options.save(phone);
    } catch (error) {
      console.warn(`bluetooth: could not note the phone: ${String(error)}`);
    }
    try {
      // So the phone does not stay connected (it has nothing to use the kiosk for).
      await this.options.disconnect(phone.address);
    } catch (error) {
      console.warn(`bluetooth: could not disconnect the phone: ${String(error)}`);
    }
    if (this.running === running) await this.end({ state: 'paired', phone });
    this.options.log(`Pairing: paired ${phone.name} (${phone.address})`);
  }

  /** Stops looking for phones. */
  async stop(): Promise<void> {
    if (!this.running) return;
    await this.end({ state: 'idle' });
    this.options.log('Pairing stopped');
  }

  /** Drops a forgotten phone from the saved list, and from the status if it was the one just paired. */
  async forget(address: string): Promise<void> {
    await this.options.forget(address);
    if (this.current.state === 'paired' && this.current.phone.address === address) this.current = { state: 'idle' };
  }

  status(): PairingStatus {
    return this.current;
  }
}

/** The phones in `file`; none when there is no file or it cannot be read. */
export async function readPhones(file: string): Promise<PairedPhone[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (Array.isArray(parsed)) return parsed as PairedPhone[];
  } catch {
    // No file yet, or an unreadable one: start a new list.
  }
  return [];
}

async function writePhones(file: string, phones: PairedPhone[]): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(phones, null, 2)}\n`);
  await rename(temporary, file);
}

/** Notes a paired phone in `file` (a JSON list), replacing an earlier entry for the same address. */
export async function savePhone(file: string, phone: PairedPhone): Promise<void> {
  const phones = await readPhones(file);
  await writePhones(file, [...phones.filter(known => known.address !== phone.address), phone]);
}

/** Drops a phone from `file`, if it is there. */
export async function forgetPhone(file: string, address: string): Promise<void> {
  const phones = await readPhones(file);
  const next = phones.filter(known => known.address !== address);
  if (next.length !== phones.length) await writePhones(file, next);
}
