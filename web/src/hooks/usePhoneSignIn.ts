import { useEffect, useRef, useState } from 'react';
import type { SpotifySignIn } from 'countdown-api';
import { serverClient } from '../countdown/config';
import { forgetSetupVerifier, setupVerifier } from '../countdown/registration';
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
    // A function, so each await's check reads the signal again rather than what an earlier check narrowed it to.
    const stopped = () => signal.aborted;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let signIn: PhoneSignIn | null = null;
    const later = () => {
      timer = setTimeout(() => void ask(), PHONE_SIGN_IN_POLL_MS);
    };
    const ask = async () => {
      if (!signIn || Date.now() >= signIn.expiresAt) {
        signIn = await startPhoneSignIn(client, site, signal);
        if (stopped()) return;
        if (signIn) {
          const { pageUrl } = signIn;
          setState(current => ({ ...current, code: { pageUrl } }));
        }
        later();
        return;
      }
      const { verifier } = signIn;
      const reply = await phoneSignInReply(client, signIn, signal);
      if (stopped()) return;
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
      if (stopped()) return;
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

/**
 * The first person's sign-in during setup, on a server that follows the setup: the server made `signIn` itself, from
 * the challenge the kiosk reported when it registered, and sent the owner's phone to Spotify with it. The kiosk asks
 * for its result every couple of seconds, exchanges Spotify's code with the verifier it kept, forgets the verifier and
 * calls `onSignedIn`. A sign-in that failed, lapsed or couldn't be finished is left alone: the phone is offered to try
 * again, and the setup's status then names a new one.
 */
export function useSetupSignIn(signIn: SpotifySignIn | undefined, onSignedIn: () => void): void {
  const onSignedInRef = useRef(onSignedIn);
  useEffect(() => {
    onSignedInRef.current = onSignedIn;
  }, [onSignedIn]);
  const id = signIn?.id;
  const redirectUri = signIn?.redirect_uri;

  useEffect(() => {
    const client = serverClient();
    const verifier = setupVerifier();
    if (!client || !verifier || !id || !redirectUri) return;
    const controller = new AbortController();
    const { signal } = controller;
    // A function, so each await's check reads the signal again rather than what an earlier check narrowed it to.
    const stopped = () => signal.aborted;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      const reply = await phoneSignInReply(client, { id, redirectUri }, signal);
      if (stopped()) return;
      if (reply === null || reply === 'waiting') {
        timer = setTimeout(() => void ask(), PHONE_SIGN_IN_POLL_MS);
        return;
      }
      if (reply === 'gone') return;
      const result = await finishSignIn(reply, verifier);
      if (stopped() || !result.ok) return;
      forgetSetupVerifier();
      onSignedInRef.current();
    };
    void ask();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [id, redirectUri]);
}
