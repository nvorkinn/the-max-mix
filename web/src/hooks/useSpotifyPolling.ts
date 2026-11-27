import { useSyncExternalStore } from 'react';
import { isSpotifyQuotaExceeded, subscribeSpotifyQuota } from '../spotify/http';
import { getPollSpotifyNow, subscribePollSpotify } from '../spotify/polling';

/**
 * Whether the app should read Spotify on a timer: the setting says so, and Spotify's quota is not used up. When the
 * quota is exceeded nothing polls again until the app is restarted.
 */
export function useSpotifyPolling(): { enabled: boolean; quotaExceeded: boolean } {
  const enabled = useSyncExternalStore(subscribePollSpotify, getPollSpotifyNow, getPollSpotifyNow);
  const quotaExceeded = useSyncExternalStore(subscribeSpotifyQuota, isSpotifyQuotaExceeded, isSpotifyQuotaExceeded);
  return { enabled, quotaExceeded };
}
