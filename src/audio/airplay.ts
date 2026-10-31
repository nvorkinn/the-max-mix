// The Pi's audio service (pi/kiosk-audio), which sends this browser's sound to AirPlay speakers through PipeWire. It
// listens only on the Pi's loopback address and answers only the app's own origin, so this works on the kiosk alone.

/** Keep in step with kiosk_audio_port in the Ansible role. */
export const AUDIO_SERVICE_URL = 'http://127.0.0.1:47878/v1/airplay';

interface AirPlaySpeaker {
  /** PipeWire's node name, which stays the same when a speaker drops off the network and comes back. */
  id: string;
  name: string;
  selected: boolean;
}

export interface AirPlayStatus {
  speakers: AirPlaySpeaker[];
  /** The chosen speakers, including any that are not on the network right now. */
  selected: string[];
  /** True while the browser has an audio stream open in PipeWire. */
  playing: boolean;
}

export const AUDIO_SERVICE_UNREACHABLE = 'The AirPlay service on this device is not running.';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function parseSpeaker(value: unknown): AirPlaySpeaker | null {
  if (!isRecord(value) || typeof value['id'] !== 'string' || !value['id']) return null;
  const name = typeof value['name'] === 'string' && value['name'] ? value['name'] : value['id'];
  return { id: value['id'], name, selected: value['selected'] === true };
}

/** The service's reply, checked: anything malformed is dropped rather than trusted. */
export function parseStatus(value: unknown): AirPlayStatus {
  if (!isRecord(value)) throw new Error('The AirPlay service sent an unexpected reply.');
  const speakers = Array.isArray(value['speakers']) ? value['speakers'].map(item => parseSpeaker(item)) : [];
  const selected = Array.isArray(value['selected']) ? value['selected'] : [];
  return {
    speakers: speakers.filter(speaker => speaker !== null),
    selected: selected.filter((id): id is string => typeof id === 'string'),
    playing: value['playing'] === true
  };
}

async function call(init: RequestInit): Promise<AirPlayStatus> {
  let response: Response;
  try {
    response = await fetch(AUDIO_SERVICE_URL, { ...init, cache: 'no-store', signal: AbortSignal.timeout(8000) });
  } catch {
    throw new Error(AUDIO_SERVICE_UNREACHABLE);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const reason = isRecord(body) && typeof body['error'] === 'string' ? body['error'] : `HTTP ${response.status}`;
    throw new Error(`AirPlay: ${reason}.`);
  }
  return parseStatus(body);
}

export const getAirPlayStatus = (): Promise<AirPlayStatus> => call({ method: 'GET' });

/** Sends the sound to exactly these speakers; an empty list hands it back to the Pi's own output. */
export const setAirPlaySpeakers = (ids: string[]): Promise<AirPlayStatus> =>
  call({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ speakers: ids }) });
