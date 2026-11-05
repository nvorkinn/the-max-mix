// Bluetooth speakers on the kiosk. The Pi's audio service (pi/kiosk-audio/bluetooth.ts) pairs and connects them over
// http://127.0.0.1; once one is connected it is an audio output like an AirPlay speaker (see airplay.ts).
import { errorMessage } from '../utils/errorMessage';
import { KIOSK_SERVICE } from '../utils/kioskService';

export interface BluetoothSpeaker {
  address: string;
  name: string;
  paired: boolean;
  connected: boolean;
}

// A scan takes about 8 s on the Pi, and a pairing up to 30 s.
const SCAN_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 70_000;

function parseSpeakers(body: unknown): BluetoothSpeaker[] {
  const list = typeof body === 'object' && body !== null ? (body as { devices?: unknown }).devices : null;
  if (!Array.isArray(list)) return [];
  const speakers: BluetoothSpeaker[] = [];
  for (const item of list as unknown[]) {
    const entry = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    if (typeof entry['address'] === 'string' && typeof entry['name'] === 'string') {
      speakers.push({
        address: entry['address'],
        name: entry['name'],
        paired: entry['paired'] === true,
        connected: entry['connected'] === true
      });
    }
  }
  return speakers;
}

/** The service's answer as JSON; a failure carries the service's own message when it sent one. */
async function ask(path: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${KIOSK_SERVICE}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new Error(`The kiosk’s audio service did not answer: ${errorMessage(error)}`, { cause: error });
  }
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  if (!response.ok) {
    throw new Error(typeof body?.error === 'string' ? body.error : `The kiosk could not do that (${response.status}).`);
  }
  return body;
}

const post = (body?: unknown): RequestInit => ({
  method: 'POST',
  ...(body !== undefined && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
});

/** The Bluetooth speakers the Pi knows: paired ones and those seen in the last scan. */
export async function listBluetoothSpeakers(): Promise<BluetoothSpeaker[]> {
  return parseSpeakers(await ask('/bluetooth/devices', {}, SCAN_TIMEOUT_MS));
}

/** Looks for speakers for a few seconds (put the speaker in pairing mode first). */
export async function scanBluetoothSpeakers(): Promise<BluetoothSpeaker[]> {
  return parseSpeakers(await ask('/bluetooth/scan', post(), SCAN_TIMEOUT_MS));
}

/** Pairs (if needed) and connects; rejects with a message that says what to do. */
export async function connectBluetoothSpeaker(address: string): Promise<void> {
  const body = (await ask('/bluetooth/connect', post({ address }), CONNECT_TIMEOUT_MS)) as {
    ok?: unknown;
    error?: unknown;
  } | null;
  if (body?.ok !== true) throw new Error(typeof body?.error === 'string' ? body.error : 'Could not connect.');
}

/** Forgets a speaker: disconnects and unpairs it. */
export async function forgetBluetoothSpeaker(address: string): Promise<void> {
  await ask('/bluetooth/remove', post({ address }), SCAN_TIMEOUT_MS).catch(() => {
    // A 204 has no body to parse; any real failure shows up as the speaker staying in the list.
  });
}
