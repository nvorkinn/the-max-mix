import { useEffect, useRef, useState } from 'react';
import { serverClient } from '../countdown/config';
import { countdownServer } from '../countdown/server';
import { phoneSignInReply, startPhoneSignIn } from '../countdown/spotifySignIn';
import type { PhoneSignIn } from '../countdown/spotifySignIn';
import { finishSignIn } from '../spotify/auth';

/** How often the kiosk asks whether the phone is back from Spotify while the QR code is up. */
export const PHONE_SIGN_IN_POLL_MS = 2000;

/**
 * Where a Spotify sign-in on a phone stands: `unavailable` when the kiosk can't hand one to a phone (it isn't
 * registered with countdown-server, or the build names no settings site), `starting` until the server has made one,
 * or the page its QR code opens. `error` says why the last one didn't sign anyone in; a new code is shown meanwhile.
 */
export interface PhoneSignInState {
  readonly code: 'unavailable' | 'starting' | { readonly pageUrl: string };
  readonly error: string | null;
}

/**
 * A QR code for signing in to Spotify on a phone, asked about every couple of seconds until the phone is back. Then the kiosk finishes the sign-in itself and calls `onSignedIn`. With `as`, it signs that person in again.
 * A code that lapses, or that didn't sign anyone in, is replaced by a new one.
 */
export function usePhoneSignIn(onSignedIn: () => void, as = ''): PhoneSignInState {
  const [state, setState] = useState<PhoneSignInState>({ code: 'starting', error: null });
  const onSignedInRef = useRef(onSignedIn);
  useEffect(() => {
    onSignedInRef.current = onSignedIn;
  }, [onSignedIn]);

  useEffect(() => {
    const client = serverClient();
    const site = countdownServer();
    if (!client || !site) return;
    const controller = new AbortController();
    const { signal } = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let signIn: PhoneSignIn | null = null;
    const later = () => {
      timer = setTimeout(() => void ask(), PHONE_SIGN_IN_POLL_MS);
    };
    const ask = async () => {
      if (!signIn || Date.now() >= signIn.expiresAt) {
        signIn = await startPhoneSignIn(client, site, signal);
        if (signal.aborted) return;
        if (signIn) {
          const { pageUrl } = signIn;
          setState(current => ({ ...current, code: { pageUrl } }));
        }
        later();
        return;
      }
      const { verifier } = signIn;
      const reply = await phoneSignInReply(client, signIn, signal);
      if (signal.aborted) return;
      if (reply === null || reply === 'waiting') {
        later();
        return;
      }
      signIn = null;
      if (reply === 'gone') {
        later();
        return;
      }
      const result = await finishSignIn(reply, verifier, as);
      if (signal.aborted) return;
      if (result.ok) {
        onSignedInRef.current();
        return;
      }
      setState(current => ({ ...current, error: result.error }));
      void ask();
    };
    void ask();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [as]);

  return serverClient() && countdownServer() ? state : { code: 'unavailable', error: null };
}
