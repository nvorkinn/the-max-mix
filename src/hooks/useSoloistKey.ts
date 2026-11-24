import { useEffect, useState } from 'react';
import { serverClient } from '../countdown/config';
import { countdownServer } from '../countdown/server';
import { newSoloistKeyCode, soloistKeyPeople } from '../countdown/soloistKeys';
import type { SoloistKeyCode } from '../countdown/soloistKeys';

/**
 * How often the kiosk asks again while a person's Soloist key code is up, so the code goes soon after they paste their
 * key on their phone.
 */
export const SOLOIST_KEY_POLL_MS = 5000;

/**
 * Where a person's Spotify Soloist API key stands: `unavailable` while none can be saved from here (the kiosk isn't
 * registered, nobody owns it, or the build names no settings site) and until the server has said; `saved`; `missing`;
 * or, while a code is asked for, the page that code opens on their phone.
 */
export type SoloistKey = 'unavailable' | 'saved' | 'missing' | { readonly pageUrl: string };

/**
 * Whether `person` has a Soloist key on countdown-server, asked when the person's settings come up. While `isAsking`,
 * also a code for them to save one with, asked again every few seconds until their key is there; a code that has
 * lapsed is replaced by a new one, which redraws the QR code.
 */
export function useSoloistKey(person: string, isAsking: boolean): SoloistKey {
  const [key, setKey] = useState<SoloistKey>('unavailable');

  useEffect(() => {
    const client = serverClient();
    const site = countdownServer();
    // With no server to ask, or no page to send a phone to, no key can be saved.
    if (!client || !site) return;
    const controller = new AbortController();
    const { signal } = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let code: SoloistKeyCode | null = null;
    const ask = async () => {
      const people = await soloistKeyPeople(client, signal);
      if (signal.aborted) return;
      if (people === 'unpaired') {
        setKey('unavailable');
        return;
      }
      if (people?.includes(person)) {
        setKey('saved');
        return;
      }
      if (!isAsking) {
        // A missed answer leaves what the server said last, but a code no longer asked for is gone.
        setKey(current => (people !== null || typeof current === 'object' ? 'missing' : current));
        return;
      }
      if (!code || Date.now() >= code.expiresAt) {
        const fresh = await newSoloistKeyCode(client, site, person, signal);
        if (signal.aborted) return;
        if (fresh === 'unpaired') {
          setKey('unavailable');
          return;
        }
        // With no code this time, none shows (a lapsed one would only open a page that turns the key away) until the
        // next try.
        code = fresh;
      }
      // The same code is the same state, so the QR code isn't drawn again until it changes.
      setKey(code ?? 'missing');
      timer = setTimeout(() => void ask(), SOLOIST_KEY_POLL_MS);
    };
    void ask();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [person, isAsking]);

  return key;
}
