// Playing on a Sonos room from the kiosk. Spotify will not move its playback to a Sonos from this app (the Web API hides
// Sonos as a restricted device), so the Pi's local service asks the speaker itself with sonoscli
// (pi/kiosk-audio/sonos.ts): the song goes into the room's Sonos queue and plays through the Spotify account linked in
// the Sonos app.
import { errorMessage } from '../utils/errorMessage';
import { KIOSK_SERVICE } from '../utils/kioskService';

// sonoscli looks for the speakers for up to 15 s and the service gives it 25 s.
const TIMEOUT_MS = 30_000;

/** Plays the Spotify item (a spotify: URI) on the Sonos room; rejects with a message to show when it could not. */
export async function playOnSonosRoom(room: string, uri: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${KIOSK_SERVICE}/sonos/play`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room, uri }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (error) {
    throw new Error(`The kiosk’s audio service did not answer: ${errorMessage(error)}`, { cause: error });
  }
  if (response.ok) return;
  if (response.status === 400) throw new Error('This song can’t be played on Sonos.');
  if (response.status === 404) throw new Error('This Pi can’t play to Sonos yet. Update it in Settings.');
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  throw new Error(typeof body?.error === 'string' ? body.error : `Sonos did not start playing (${response.status}).`);
}
