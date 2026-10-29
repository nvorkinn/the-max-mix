import { useEffect, useState } from 'react';
import { NETWORK_ERROR_MESSAGE } from '../spotify/http';

/** How long Spotify calls must keep failing with network errors before the device counts as offline. */
const NETWORK_FAILURE_GRACE_MS = 20_000;

/** The browser's own view of the connection, kept up to date from the online and offline events. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

/**
 * True while the browser says it is offline, or once Spotify calls have failed with network errors for a while
 * (the browser can claim to be online behind a router with no internet). Clears by itself when either recovers.
 */
export function useIsOffline(playerError: string | null | undefined): boolean {
  const online = useOnlineStatus();
  const [failingLong, setFailingLong] = useState(false);
  const networkFailing = playerError === NETWORK_ERROR_MESSAGE;
  useEffect(() => {
    if (!networkFailing) return undefined;
    const timer = setTimeout(() => setFailingLong(true), NETWORK_FAILURE_GRACE_MS);
    return () => {
      clearTimeout(timer);
      setFailingLong(false);
    };
  }, [networkFailing]);
  return !online || (networkFailing && failingLong);
}
