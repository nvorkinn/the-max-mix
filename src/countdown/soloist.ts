// Spotify Soloist's API key, from countdown-server to the Pi. Soloist (Spotify's headless Spotify Connect player, which
// runs on the Pi beside the app's own player) won't start without the key on the Pi, and the Pi installs from a public
// release, so it comes from the owner's account: they save their own key on countdown-server's Account page, and
// GET /api/devices/soloist/key (countdown-api's getSoloistKey) answers it to their paired touchscreen, with the device
// secret. The kiosk hands it straight to its local service (POST /soloist/key,
// pi/kiosk-audio/soloist.ts), which stores it for the player. The key is never kept, logged or shown here.

import { getSoloistKey } from '../../vendor/countdown-api/src/countdown_api/client';
import type { Client } from '../../vendor/countdown-api/src/countdown_api/client';
import { KIOSK_SERVICE } from '../utils/kioskService';
import { serverClient } from './config';

/** How often the kiosk tries again while the player has no key (not paired yet, server or Pi not answering). */
const SOLOIST_KEY_RETRY_MS = 10 * 60_000;
/** How often it asks again once the player has one, so a new key on the server reaches the Pi. */
const SOLOIST_KEY_REFRESH_MS = 6 * 60 * 60_000;

/** Fetches the key and hands it to the kiosk's service; true once the service has it. */
export async function handOverSoloistKey(client: Client | null = serverClient()): Promise<boolean> {
  if (!client) return false;
  try {
    const { data } = await getSoloistKey(client);
    if (!data?.api_key) return false;
    const response = await fetch(`${KIOSK_SERVICE}/soloist/key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: data.api_key })
    });
    if (!response.ok) console.warn(`The kiosk could not store the Soloist key (${response.status})`);
    return response.ok;
  } catch {
    return false;
  }
}

/** Hands the key over now, then again on a timer. Returns the function that stops it. */
export function startSoloistKey(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const run = async () => {
    const isStored = await handOverSoloistKey();
    if (!stopped) timer = setTimeout(() => void run(), isStored ? SOLOIST_KEY_REFRESH_MS : SOLOIST_KEY_RETRY_MS);
  };
  void run();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
