// AirPlay mode on the kiosk. PipeWire makes an audio output for each AirPlay speaker it finds; the kiosk's audio service
// (pi/kiosk-audio/server.ts) lists them over http://127.0.0.1. The Pi routes the sound: the page asks the
// service to (POST /audio/route). The service does not report which speakers are chosen, so the page remembers them.
import { errorMessage } from '../utils/errorMessage';
import { KIOSK_SERVICE, kioskPost } from '../utils/kioskService';

const SPEAKERS_KEY = 'maxmix.airplaySpeakers';
const POLL_MS = 5000;

/** The names of the AirPlay speakers the Pi found, sorted. */
export async function listAudioOutputs(): Promise<string[]> {
  let response: Response;
  try {
    response = await fetch(`${KIOSK_SERVICE}/speakers`, { cache: 'no-store' });
  } catch (error) {
    throw new Error(`The kiosk’s audio service did not answer: ${errorMessage(error)}`, { cause: error });
  }
  if (!response.ok) throw new Error(`The kiosk’s audio service could not read PipeWire (${response.status}).`);
  const body = (await response.json()) as { speakers?: unknown };
  const names = Array.isArray(body.speakers) ? body.speakers.filter(name => typeof name === 'string') : [];
  return [...new Set(names)].toSorted((a, b) => a.localeCompare(b));
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
