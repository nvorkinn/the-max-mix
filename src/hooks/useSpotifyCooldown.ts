import { useSyncExternalStore } from 'react';
import { getSpotifyRetryAt, subscribeSpotifyRetryAt } from '../spotify/http';

export function useSpotifyCooldown(): number {
  return useSyncExternalStore(subscribeSpotifyRetryAt, getSpotifyRetryAt, getSpotifyRetryAt);
}
