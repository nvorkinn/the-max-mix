import { useEffect, useState } from 'react';
import { watchSoloistAuth } from '../spotify/soloistSignIn';

/**
 * How long Soloist has to say it is signed out before that is taken as so: as it starts it says so for a moment, before
 * it restores the person's session.
 */
export const SIGNED_OUT_AFTER_MS = 3000;

/** Where Soloist's sign-in stands. */
interface SoloistSignIn {
  /** Whether Soloist is signed in to Spotify; null until it has said, and while a sign-out may only be its start. */
  isSignedIn: boolean | null;
  /** The name it goes by in Spotify's device list; null until it has said. */
  deviceName: string | null;
}

/** Whether Soloist is signed in, asked and followed while `isWatching`. */
export function useSoloistSignIn(isWatching: boolean): SoloistSignIn {
  const [signIn, setSignIn] = useState<SoloistSignIn>({ isSignedIn: null, deviceName: null });
  useEffect(() => {
    if (!isWatching) return;
    let signedOut: ReturnType<typeof setTimeout> | undefined;
    const stop = watchSoloistAuth(({ isSignedIn, deviceName }) => {
      clearTimeout(signedOut);
      if (isSignedIn) setSignIn({ isSignedIn, deviceName });
      else signedOut = setTimeout(() => setSignIn({ isSignedIn, deviceName }), SIGNED_OUT_AFTER_MS);
    });
    return () => {
      clearTimeout(signedOut);
      stop();
    };
  }, [isWatching]);
  return signIn;
}
