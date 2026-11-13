// "Pair my phone", started from the debug console's Bluetooth section: for two minutes the kiosk shows up on phones as a
// keyboard called THE MAX MIX (pairing-gatt.ts). The first device that pairs with BlueZ meanwhile is the phone: the kiosk
// stops advertising, drops the connection (so the phone does not use it as a keyboard) and notes the phone in
// phones.json next to speakers.json. BlueZ keeps the phone's identity key, which is what later lets the kiosk tell that
// phone is nearby even as its address changes.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PairingAdvertising } from './pairing-gatt.ts';

const WINDOW_MS = 2 * 60 * 1000;
const CHECK_MS = 1000;

export const PAIRING_ERRORS = {
  unavailable: 'Bluetooth is not available, so no phone can pair.',
  timedOut: 'No phone paired within 2 minutes.'
} as const;

export interface PairedPhone {
  address: string;
  name: string;
  /** When it paired, ms since 1970. */
  pairedAt: number;
}

export type PairingStatus =
  | { state: 'idle' }
  | { state: 'waiting'; secondsLeft: number }
  | { state: 'paired'; phone: PairedPhone }
  | { state: 'failed'; error: string };

/** A device BlueZ knows, as bluetooth-monitor.ts reports it. */
interface Device {
  address: string;
  name: string;
  paired: boolean;
  bonded: boolean;
}

export interface PhonePairingOptions {
  advertise: () => Promise<PairingAdvertising>;
  /** The devices BlueZ has paired. */
  devices: () => Promise<Device[]>;
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

const isBonded = (device: Device) => device.paired || device.bonded;

export class PhonePairing {
  private readonly options: PhonePairingOptions;
  private readonly now: () => number;
  private current: PairingStatus = { state: 'idle' };
  private running:
    | { advertising: PairingAdvertising; known: Set<string>; deadline: number; timer: ReturnType<typeof setInterval> }
    | undefined;
  private starting: Promise<void> | undefined;

  constructor(options: PhonePairingOptions) {
    this.options = options;
    this.now = options.now ?? (() => Date.now());
  }

  private async begin(): Promise<void> {
    const windowMs = this.options.windowMs ?? WINDOW_MS;
    if (this.running) {
      this.running.deadline = this.now() + windowMs;
      this.options.log('Pairing: two more minutes');
      return;
    }
    const known = new Set(
      (await this.options.devices()).filter(device => isBonded(device)).map(device => device.address)
    );
    let advertising: PairingAdvertising;
    try {
      advertising = await this.options.advertise();
    } catch (error) {
      console.warn(`bluetooth: pairing did not start: ${String(error)}`);
      this.current = { state: 'failed', error: PAIRING_ERRORS.unavailable };
      this.options.log('Pairing could not start');
      throw new Error(PAIRING_ERRORS.unavailable, { cause: error });
    }
    const timer = setInterval(() => void this.check(), this.options.checkMs ?? CHECK_MS);
    this.running = { advertising, known, deadline: this.now() + windowMs, timer };
    this.current = { state: 'waiting', secondsLeft: Math.round(windowMs / 1000) };
    this.options.log('Pairing: showing up as a keyboard called THE MAX MIX');
  }

  /** Looks for a newly paired device, or gives up at the deadline. */
  private async check(): Promise<void> {
    const running = this.running;
    if (!running) return;
    let devices: Device[] = [];
    try {
      devices = await this.options.devices();
    } catch (error) {
      console.warn(`bluetooth: pairing check failed: ${String(error)}`);
    }
    if (this.running !== running) return;
    const phone = devices.find(device => isBonded(device) && !running.known.has(device.address));
    if (phone) {
      await this.finish({ address: phone.address, name: phone.name, pairedAt: this.now() });
    } else if (this.now() >= running.deadline) {
      await this.end({ state: 'failed', error: PAIRING_ERRORS.timedOut });
      this.options.log('Pairing: no phone paired in time');
    } else {
      this.current = { state: 'waiting', secondsLeft: Math.ceil((running.deadline - this.now()) / 1000) };
    }
  }

  private async finish(phone: PairedPhone): Promise<void> {
    await this.end({ state: 'paired', phone });
    this.options.log(`Pairing: paired ${phone.name} (${phone.address})`);
    try {
      await this.options.disconnect(phone.address);
    } catch (error) {
      console.warn(`bluetooth: could not disconnect the phone: ${String(error)}`);
    }
    try {
      await this.options.save(phone);
    } catch (error) {
      console.warn(`bluetooth: could not note the phone: ${String(error)}`);
    }
  }

  /** Stops advertising and settles on `status`. */
  private async end(status: PairingStatus): Promise<void> {
    const running = this.running;
    this.running = undefined;
    this.current = status;
    if (!running) return;
    clearInterval(running.timer);
    await running.advertising.stop();
  }

  /** Starts a pairing window, or gives the current one two more minutes. Rejects when Bluetooth would not. */
  async start(): Promise<void> {
    const pending = (this.starting ??= this.begin());
    try {
      await pending;
    } finally {
      if (this.starting === pending) this.starting = undefined;
    }
  }

  /** Stops a pairing window. */
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

/** Renames a saved phone in `file`, if it is there. */
export async function renamePhone(file: string, address: string, name: string): Promise<void> {
  const phones = await readPhones(file);
  if (phones.some(known => known.address === address)) {
    await writePhones(
      file,
      phones.map(known => (known.address === address ? { ...known, name } : known))
    );
  }
}
