// Which of the kiosk's people have a Spotify Soloist API key saved on countdown-server, and the codes they save one
// with. A person saves their key on their phone: the kiosk asks for a code for them (countdown-api's
// createSoloistKeyCode) and shows it as a QR code of the settings site's page that takes the key (saveSoloistKeyPage).
// The kiosk only ever learns whether a key is there (listSoloistKeys): the key itself is answered to the Pi's service
// alone (soloist.ts), never to this page.

import {
  createSoloistKeyCode,
  deleteSoloistKey,
  listSoloistKeys,
  saveSoloistKeyPageUrl
} from '../../vendor/countdown-api/src/countdown_api/client';
import type { Client } from '../../vendor/countdown-api/src/countdown_api/client';
import { serverClient } from './config';

/**
 * What the server says of a call: `unpaired` when nobody owns the kiosk yet (409), so no key can be saved for it, and
 * null when it can't be told (the server can't be reached, refuses, or is one from before Soloist keys).
 */
type Unanswered = 'unpaired' | null;

/** The page a person saves their key on, and when its code lapses (as Date.now() counts). */
export interface SoloistKeyCode {
  readonly pageUrl: string;
  readonly expiresAt: number;
}

/** The Spotify IDs of the kiosk's people who have a key saved. */
export async function soloistKeyPeople(client: Client, signal: AbortSignal): Promise<readonly string[] | Unanswered> {
  try {
    const { data, response } = await listSoloistKeys(client, { signal });
    return response.status === 409 ? 'unpaired' : (data?.people ?? null);
  } catch {
    return null;
  }
}

/** A new code for `person` to save their key with, as the settings site's page on `site` that takes it. */
export async function newSoloistKeyCode(
  client: Client,
  site: string,
  person: string,
  signal: AbortSignal
): Promise<SoloistKeyCode | Unanswered> {
  try {
    const { data, response } = await createSoloistKeyCode(client, { person }, { signal });
    if (response.status === 409) return 'unpaired';
    if (!data) return null;
    return {
      pageUrl: saveSoloistKeyPageUrl(site, { code: data.code }).href,
      expiresAt: Date.now() + data.expires_in * 1000
    };
  } catch {
    return null;
  }
}

/**
 * Forgets the key of a person removed from the kiosk, so it isn't kept for someone who no longer plays here. Nothing
 * waits for it: a key the server can't forget now (or never had) changes nothing on the kiosk.
 */
export function forgetSoloistKey(person: string, client: Client | null = serverClient()): void {
  if (!client) return;
  void deleteSoloistKey(client, { person }).catch(() => null);
}
