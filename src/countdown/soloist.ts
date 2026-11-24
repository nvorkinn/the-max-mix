// Who Spotify Soloist plays for. Soloist (Spotify's headless Spotify Connect player) runs on the Pi with the active
// person's own API key, which they saved on countdown-server's settings site. That key is answered only to the Pi's
// service, never to this page, so this only says who is active, with the device secret: the service
// (POST /soloist/person, pi/kiosk-audio/soloist.ts) fetches their key and runs Soloist for them. With nobody signed in,
// it stops Soloist (POST /soloist/stop). Switching person reloads the page, which says it again.

import type { Client } from '../../vendor/countdown-api/src/countdown_api/client';
import { getActivePersonId, peopleOnKiosk } from '../spotify/auth';
import { KIOSK_SERVICE } from '../utils/kioskService';
import { serverClient } from './config';

/**
 * How often the page says it again: a key saved since, or a restarted service, then takes effect. Saying the same
 * person again changes nothing while Soloist plays for them.
 */
const SOLOIST_PERSON_MS = 10 * 60_000;

/** What the service said Soloist is doing (pi/kiosk-audio/soloist.ts's SoloistState), or null when it did not answer. */
type SoloistState = string | null;

async function postToKiosk(path: string, body?: unknown): Promise<Response> {
  return fetch(`${KIOSK_SERVICE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) })
  });
}

/** Tells the kiosk's service who Soloist plays for now; resolves with its state. */
export async function tellSoloistPerson(client: Client | null = serverClient()): Promise<SoloistState> {
  try {
    if (peopleOnKiosk().length === 0) {
      await postToKiosk('/soloist/stop');
      return 'stopped';
    }
    const person = getActivePersonId();
    if (!client || !person) return null;
    const response = await postToKiosk('/soloist/person', {
      person,
      server: client.baseUrl,
      secret: client.secret
    });
    if (!response.ok) return null;
    const { state } = (await response.json()) as { state?: unknown };
    return typeof state === 'string' ? state : null;
  } catch {
    return null;
  }
}

/** Says who is active now, then again on a timer. Returns the function that stops it. */
export function startSoloistPerson(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const run = async () => {
    await tellSoloistPerson();
    if (!stopped) timer = setTimeout(() => void run(), SOLOIST_PERSON_MS);
  };
  void run();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
