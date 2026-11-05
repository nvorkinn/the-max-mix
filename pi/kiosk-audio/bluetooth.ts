// Bluetooth speakers through BlueZ's bluetoothctl, for the app's Speakers drawer: find them, pair and connect one, and
// forget one. Every command is an argument list, never a shell, and an address is checked before it is used. Once a
// speaker is connected, PipeWire (libspa-0.2-bluetooth) makes an output for it, which speakers.ts lists and routes to
// like an AirPlay speaker. The service runs as the kiosk user, which is in the bluetooth group (BlueZ's D-Bus policy).
import { runCommand } from './nmcli.ts';
import type { Run } from './nmcli.ts';

const ADDRESS_BYTE = /^[\dA-F]{2}$/;
const SCAN_SECONDS = 8;
const PAIR_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 20_000;
const QUICK_TIMEOUT_MS = 5000;
const MAX_DEVICES = 30;

export interface BluetoothDevice {
  address: string;
  name: string;
  paired: boolean;
  connected: boolean;
}

export type ConnectResult = { ok: true } | { ok: false; error: string };

export const ERRORS = {
  unavailable: 'Bluetooth is not available on this device.',
  busy: 'Bluetooth is busy. Wait a moment and try again.',
  notFound: 'Speaker not found. Put it in pairing mode, then search again.',
  pairFailed: 'Could not pair. Put the speaker in pairing mode and try again.',
  connectFailed: 'Paired, but could not connect. Turn the speaker off and on, then try again.'
} as const;

/** Thrown with a message that is safe to show in the app. */
export class BluetoothError extends Error {
  override name = 'BluetoothError';
}

/** The request body's address in upper case, or null when it is not a Bluetooth address. */
export function parseAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const address = value.trim().toUpperCase();
  const bytes = address.split(':');
  return bytes.length === 6 && bytes.every(byte => ADDRESS_BYTE.test(byte)) ? address : null;
}

/** The devices in `bluetoothctl devices` output: lines like `Device AA:BB:CC:DD:EE:FF Name`. */
export function parseDeviceList(text: string): { address: string; name: string }[] {
  const devices: { address: string; name: string }[] = [];
  for (const line of text.split('\n')) {
    const [kind, address, ...name] = line.trim().split(' ');
    const parsed = kind === 'Device' ? parseAddress(address) : null;
    if (parsed) devices.push({ address: parsed, name: name.join(' ').trim() || parsed });
  }
  return devices;
}

/** What `bluetoothctl info` says about a device; `isAudio` is true for something that can play sound. */
export function parseInfo(text: string): { name: string; paired: boolean; connected: boolean; isAudio: boolean } {
  const fields = new Map<string, string>();
  for (const line of text.split('\n')) {
    const colon = line.indexOf(': ');
    if (colon > 0) fields.set(line.slice(0, colon).trim(), line.slice(colon + 2).trim());
  }
  const field = (label: string) => fields.get(label) ?? '';
  return {
    name: field('Alias') || field('Name'),
    paired: field('Paired') === 'yes',
    connected: field('Connected') === 'yes',
    // "Audio Sink" is A2DP (0000110b): a speaker or headphones. Some devices only show the icon.
    isAudio: /Audio Sink|0000110b/.test(text) || field('Icon').startsWith('audio-')
  };
}

export class Bluetooth {
  private readonly run: Run;
  private isBusy = false;

  constructor(run: Run = runCommand) {
    this.run = run;
  }

  private async ctl(args: string[], timeoutMs = QUICK_TIMEOUT_MS) {
    return this.run(['bluetoothctl', ...args], '', timeoutMs);
  }

  /** One job at a time: a scan and a pairing at once confuse BlueZ. */
  private async exclusive<T>(job: () => Promise<T>): Promise<T> {
    if (this.isBusy) throw new BluetoothError(ERRORS.busy);
    this.isBusy = true;
    try {
      return await job();
    } finally {
      this.isBusy = false;
    }
  }

  /** The audio devices BlueZ knows (paired, or seen in a scan), paired and connected ones first. */
  async list(): Promise<BluetoothDevice[]> {
    const { code, stdout } = await this.ctl(['devices']);
    if (code !== 0) throw new BluetoothError(ERRORS.unavailable);
    const known = parseDeviceList(stdout).slice(0, MAX_DEVICES);
    const infos = await Promise.all(known.map(device => this.ctl(['info', device.address])));
    const devices: BluetoothDevice[] = [];
    for (const [index, device] of known.entries()) {
      const info = parseInfo(infos[index]?.stdout ?? '');
      if (info.isAudio) {
        devices.push({
          address: device.address,
          name: info.name || device.name,
          paired: info.paired,
          connected: info.connected
        });
      }
    }
    return devices.toSorted(
      (a, b) =>
        Number(b.connected) - Number(a.connected) || Number(b.paired) - Number(a.paired) || a.name.localeCompare(b.name)
    );
  }

  /** Looks for speakers for a few seconds, then lists what BlueZ knows. */
  async scan(): Promise<BluetoothDevice[]> {
    return this.exclusive(async () => {
      await this.run(['rfkill', 'unblock', 'bluetooth'], '', QUICK_TIMEOUT_MS);
      const scan = await this.ctl(['--timeout', String(SCAN_SECONDS), 'scan', 'on'], (SCAN_SECONDS + 5) * 1000);
      if (scan.code === 127) throw new BluetoothError(ERRORS.unavailable);
      return this.list();
    });
  }

  /** Pairs (unless it is paired already), trusts so it reconnects by itself, and connects. */
  async connect(address: string): Promise<ConnectResult> {
    return this.exclusive(async () => {
      const isKnown = (await this.ctl(['devices'])).stdout.toUpperCase().includes(address);
      if (!isKnown) return { ok: false, error: ERRORS.notFound };
      const isPaired = parseInfo((await this.ctl(['info', address])).stdout).paired;
      if (!isPaired && (await this.ctl(['pair', address], PAIR_TIMEOUT_MS)).code !== 0) {
        return { ok: false, error: ERRORS.pairFailed };
      }
      await this.ctl(['trust', address]);
      const connected = await this.ctl(['connect', address], CONNECT_TIMEOUT_MS);
      return connected.code === 0 ? { ok: true } : { ok: false, error: ERRORS.connectFailed };
    });
  }

  /** Forgets a device: disconnects, unpairs and removes it. */
  async remove(address: string): Promise<void> {
    await this.exclusive(async () => {
      await this.ctl(['remove', address]);
    });
  }
}
