// Playing on a Sonos room from the kiosk. Spotify will not move its playback to a Sonos from this app (the Web API hides
// Sonos as a restricted device), so the Pi's local service asks the speaker itself (pi/kiosk-audio/sonos.ts): the song
// goes into the room's Sonos queue and plays through the Spotify account linked in the Sonos app. It can do that with
// sonoscli or with the sonos-ts library; Settings picks which while both are being tried, and offers two calls that only
// resume what the speaker has, to see what they do.
import { errorMessage } from '../utils/errorMessage';
import { KIOSK_SERVICE } from '../utils/kioskService';

// sonoscli looks for the speakers for up to 15 s and the service gives it 25 s.
const TIMEOUT_MS = 30_000;
const ENGINE_KEY = 'maxmix.sonosEngine';

/** The way the Pi talks to Sonos: sonoscli, or the sonos-ts library. */
export type SonosEngine = 'cli' | 'library';
/** The resume calls to try: `sonos play`, or sonos-ts's SwitchToQueue() then Play(). */
export type SonosTest = 'cli-play' | 'library-queue';

export function getSonosEngine(): SonosEngine {
  try {
    return localStorage.getItem(ENGINE_KEY) === 'library' ? 'library' : 'cli';
  } catch {
    return 'cli';
  }
}

export function setSonosEngine(engine: SonosEngine): void {
  try {
    localStorage.setItem(ENGINE_KEY, engine);
  } catch {
    // Storage is unavailable; sonoscli stays the way.
  }
}

// The room (player id) leading the Sonos group the kiosk last started a song on, for this page's life: tapping another
// room while that group plays adds the room to it (SonosGroupList), and while it is set the tablet shows and controls
// that group's playback (useSonosPlayer).
let kioskLeader: string | null = null;
const leaderListeners = new Set<() => void>();

export const getKioskSonosLeader = (): string | null => kioskLeader;

export function setKioskSonosLeader(playerId: string | null): void {
  if (playerId === kioskLeader) return;
  kioskLeader = playerId;
  for (const listener of leaderListeners) listener();
}

/** Calls `listener` each time the leading room changes; returns how to stop. */
export function subscribeKioskSonosLeader(listener: () => void): () => void {
  leaderListeners.add(listener);
  return () => {
    leaderListeners.delete(listener);
  };
}

async function post(path: string, body: unknown): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${KIOSK_SERVICE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (error) {
    throw new Error(`The kiosk’s audio service did not answer: ${errorMessage(error)}`, { cause: error });
  }
  if (response.ok) return;
  if (response.status === 400) throw new Error('This song can’t be played on Sonos.');
  if (response.status === 404) throw new Error('This Pi can’t do that with Sonos yet. Update it in Settings.');
  const reply = (await response.json().catch(() => null)) as { error?: unknown } | null;
  throw new Error(typeof reply?.error === 'string' ? reply.error : `Sonos did not start playing (${response.status}).`);
}

/** Plays the Spotify item (a spotify: URI) on the Sonos room; rejects with a message to show when it could not. */
export function playOnSonosRoom(room: string, uri: string, engine: SonosEngine = getSonosEngine()): Promise<void> {
  return post('/sonos/play', { room, uri, engine });
}

/** Runs one of the resume calls on the Sonos room; rejects with a message to show when it failed. */
export function testOnSonosRoom(room: string, test: SonosTest): Promise<void> {
  return post('/sonos/test', { room, test });
}
