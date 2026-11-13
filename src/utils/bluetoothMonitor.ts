// What the Pi's Bluetooth adapter reports, for the debug console (pi/kiosk-audio/bluetooth-monitor.ts): the adapter, the
// devices paired with it, how many unpaired ones are nearby, and a log of what changed.
import { errorMessage } from './errorMessage';
import { KIOSK_SERVICE } from './kioskService';

interface BluetoothAdapter {
  address: string;
  name: string;
  powered: boolean;
  discoverable: boolean;
  pairable: boolean;
  discovering: boolean;
}

export interface PairedDevice {
  address: string;
  name: string;
  addressType: string;
  icon: string;
  paired: boolean;
  bonded: boolean;
  trusted: boolean;
  connected: boolean;
  rssi: number | null;
  /** When the Pi last heard it (ms since 1970), or null. */
  lastSeen: number | null;
}

/** Where "Pair my phone" is (pi/kiosk-audio/phone-pairing.ts). */
export type PairingStatus =
  | { state: 'idle' }
  | { state: 'waiting'; secondsLeft: number }
  | { state: 'paired'; name: string; address: string }
  | { state: 'failed'; error: string };

/** A phone "Pair my phone" saved, and whether the Pi heard it lately (pi/kiosk-audio/presence.ts). */
interface PhonePresence {
  address: string;
  name: string;
  isHere: boolean;
}

export interface BluetoothReport {
  adapter: BluetoothAdapter | null;
  pairing: PairingStatus;
  phones: PhonePresence[];
  devices: PairedDevice[];
  nearby: number;
  verbose: boolean;
  /** Oldest first. */
  log: { id: number; time: number; message: string }[];
}

const TIMEOUT_MS = 8000;

type Fields = Record<string, unknown>;
const fieldsOf = (value: unknown): Fields => (typeof value === 'object' && value !== null ? (value as Fields) : {});
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const numberOrNull = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? (value as unknown[]) : []);

function parseAdapter(value: unknown): BluetoothAdapter | null {
  if (typeof value !== 'object' || value === null) return null;
  const fields = fieldsOf(value);
  return {
    address: text(fields['address']),
    name: text(fields['name']),
    powered: fields['powered'] === true,
    discoverable: fields['discoverable'] === true,
    pairable: fields['pairable'] === true,
    discovering: fields['discovering'] === true
  };
}

function parseDevice(value: unknown): PairedDevice {
  const fields = fieldsOf(value);
  return {
    address: text(fields['address']),
    name: text(fields['name']),
    addressType: text(fields['addressType']),
    icon: text(fields['icon']),
    paired: fields['paired'] === true,
    bonded: fields['bonded'] === true,
    trusted: fields['trusted'] === true,
    connected: fields['connected'] === true,
    rssi: numberOrNull(fields['rssi']),
    lastSeen: numberOrNull(fields['lastSeen'])
  };
}

function parsePairing(value: unknown): PairingStatus {
  const fields = fieldsOf(value);
  const phone = fieldsOf(fields['phone']);
  switch (fields['state']) {
    case 'waiting': {
      return { state: 'waiting', secondsLeft: typeof fields['secondsLeft'] === 'number' ? fields['secondsLeft'] : 0 };
    }
    case 'paired': {
      return { state: 'paired', name: text(phone['name']), address: text(phone['address']) };
    }
    case 'failed': {
      return { state: 'failed', error: text(fields['error']) };
    }
    default: {
      return { state: 'idle' };
    }
  }
}

/** The Pi's answer as a report; anything missing or of the wrong type reads as empty. */
export function parseBluetoothReport(value: unknown): BluetoothReport {
  const fields = fieldsOf(value);
  return {
    adapter: parseAdapter(fields['adapter']),
    pairing: parsePairing(fields['pairing']),
    phones: listOf(fields['phones'])
      .map(phone => fieldsOf(phone))
      .map(phone => ({ address: text(phone['address']), name: text(phone['name']), isHere: phone['isHere'] === true })),
    devices: listOf(fields['devices']).map(device => parseDevice(device)),
    nearby: typeof fields['nearby'] === 'number' ? fields['nearby'] : 0,
    verbose: fields['verbose'] === true,
    log: listOf(fields['log'])
      .map(line => fieldsOf(line))
      .filter(
        (line): line is { id: number; time: number; message: string } =>
          typeof line['id'] === 'number' && typeof line['time'] === 'number' && typeof line['message'] === 'string'
      )
      .map(({ id, time, message }) => ({ id, time, message }))
  };
}

/** What the Pi's Bluetooth reports now; rejects with a message to show when it cannot say. */
export async function readBluetoothReport(): Promise<BluetoothReport> {
  let response: Response;
  try {
    response = await fetch(`${KIOSK_SERVICE}/bluetooth/monitor`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new Error(`The kiosk’s audio service did not answer: ${errorMessage(error)}`, { cause: error });
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = fieldsOf(body)['error'];
    throw new Error(typeof message === 'string' ? message : `The kiosk could not say (${response.status}).`);
  }
  return parseBluetoothReport(body);
}

/** Whether the Pi logs unpaired devices too. */
export async function setBluetoothVerbose(verbose: boolean): Promise<void> {
  const response = await fetch(`${KIOSK_SERVICE}/bluetooth/monitor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verbose }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`The kiosk refused that (${response.status}).`);
}

/** Starts "Pair my phone" (or gives it two more minutes), or stops it; rejects with a message to show. */
export async function pairPhone(isStarting: boolean): Promise<void> {
  const response = await fetch(`${KIOSK_SERVICE}/bluetooth/pair-phone${isStarting ? '' : '/stop'}`, {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (response.ok) return;
  const message = fieldsOf(await response.json().catch(() => null))['error'];
  throw new Error(typeof message === 'string' ? message : `The kiosk refused that (${response.status}).`);
}
