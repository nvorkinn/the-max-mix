// AirPlay mode on the kiosk. PipeWire makes an audio output for each AirPlay speaker it finds; the kiosk's audio service
// (pi/kiosk-audio/server.ts) lists them over http://127.0.0.1. The Pi routes the sound: the page opens a kiosk-audio://
// link, which the kiosk image hands to its audio handler (pi/kiosk-audio), the same way kiosk-wifi:// opens the Wi-Fi
// panel. The link only goes one way, so the page remembers the chosen speakers itself.
import { errorMessage } from '../utils/errorMessage';

const SPEAKERS_KEY = 'maxmix.airplaySpeakers';
const SPEAKERS_URL = 'http://127.0.0.1:7341/speakers';
const POLL_MS = 5000;

/** The names of the AirPlay speakers the Pi found, sorted. */
export async function listAudioOutputs(): Promise<string[]> {
  let response: Response;
  try {
    response = await fetch(SPEAKERS_URL, { cache: 'no-store' });
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

/** The link that asks the Pi to play to exactly these outputs; with none, the Pi's own output. */
export function routeLink(speakers: readonly string[]): string {
  const query = new URLSearchParams(speakers.map(name => ['speaker', name])).toString();
  return query ? `kiosk-audio://route?${query}` : 'kiosk-audio://route';
}

/** Asks the Pi to route the sound. A top-level navigation, like the Wi-Fi link; the page stays where it is. */
export function routeAudio(speakers: readonly string[]): void {
  location.assign(routeLink(speakers));
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
