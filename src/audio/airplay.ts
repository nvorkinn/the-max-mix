// AirPlay mode on the kiosk. PipeWire makes an audio output for each AirPlay speaker it finds; the kiosk's audio service
// (pi/kiosk-audio/server.ts) lists them over http://127.0.0.1. The Pi routes the sound: the page asks the
// service to (POST /audio/route). The service does not report which speakers are chosen, so the page remembers them.
import { errorMessage } from '../utils/errorMessage';
import { KIOSK_SERVICE, kioskPost } from '../utils/kioskService';

const SPEAKERS_KEY = 'maxmix.airplaySpeakers';
const POLL_MS = 5000;

export interface AirPlaySpeakers {
  /** The speakers' names, sorted. */
  names: string[];
  /** Each speaker's volume in percent, for those that report one (none from a Pi still on an older service). */
  volumes: Record<string, number>;
}

/** The AirPlay speakers the Pi found, and their volumes. */
export async function listAudioOutputs(): Promise<AirPlaySpeakers> {
  let response: Response;
  try {
    response = await fetch(`${KIOSK_SERVICE}/speakers`, { cache: 'no-store' });
  } catch (error) {
    throw new Error(`The kiosk’s audio service did not answer: ${errorMessage(error)}`, { cause: error });
  }
  if (!response.ok) throw new Error(`The kiosk’s audio service could not read PipeWire (${response.status}).`);
  const body = (await response.json()) as { speakers?: unknown; volumes?: unknown };
  const names = Array.isArray(body.speakers) ? body.speakers.filter(name => typeof name === 'string') : [];
  const volumes: Record<string, number> = {};
  if (typeof body.volumes === 'object' && body.volumes !== null) {
    for (const [name, volume] of Object.entries(body.volumes)) {
      if (typeof volume === 'number' && volume >= 0 && volume <= 100) volumes[name] = Math.round(volume);
    }
  }
  return { names: [...new Set(names)].toSorted((a, b) => a.localeCompare(b)), volumes };
}

/** Calls `onChange` every few seconds, since speakers come and go on the network; returns the unsubscribe function. */
export function watchAudioOutputs(onChange: () => void): () => void {
  const timer = setInterval(onChange, POLL_MS);
  return () => clearInterval(timer);
}

/** Asks the Pi to play to exactly these outputs; with none, the Pi's own output. */
export function routeAudio(speakers: readonly string[]): void {
  kioskPost('/audio/route', { speakers });
}

// Per speaker: whether a volume request is on its way, and the newest value to send once it is back.
const volumeRequests = new Map<string, { latest: number | null }>();

/**
 * Sets one speaker's volume (0 to 100). While dragging, only one request per speaker is on its way at a time, and the
 * newest value follows when it is back, so the Pi is not asked for every step.
 */
export function setSpeakerVolume(speaker: string, volume: number): void {
  const pending = volumeRequests.get(speaker);
  if (pending) {
    pending.latest = volume;
    return;
  }
  const request = { latest: null as number | null };
  volumeRequests.set(speaker, request);
  void (async () => {
    let next: number | null = volume;
    while (next !== null) {
      request.latest = null;
      try {
        // eslint-disable-next-line no-await-in-loop
        const response = await fetch(`${KIOSK_SERVICE}/audio/volume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ speaker, volume: next })
        });
        if (!response.ok) console.warn(`The kiosk refused the volume of ${speaker} (${response.status})`);
      } catch (error) {
        console.warn(`The kiosk did not answer the volume of ${speaker}`, error);
      }
      next = request.latest;
    }
    volumeRequests.delete(speaker);
  })();
}

export function getChosenSpeakers(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SPEAKERS_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter((name): name is string => typeof name === 'string') : [];
  } catch {
    return [];
  }
}

export function setChosenSpeakers(speakers: readonly string[]): void {
  try {
    localStorage.setItem(SPEAKERS_KEY, JSON.stringify(speakers));
  } catch {
    // Storage is unavailable; the choice then lasts only until the page reloads.
  }
}
