// The app's settings, kept in the browser's own storage, so the app needs no backend. Storage can be unavailable
// (private windows, blocked site data): every access tolerates that.

// The app's Spotify client ID. It is public by design (sign-in uses PKCE and there is no client secret), so it lives in the
// code and users never enter it.
const SPOTIFY_CLIENT_ID = '79012ca710ca4dd5ad18c2973510b670';
const PLAYBACK_MODE_KEY = 'maxmix.playbackMode';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function getClientId(): string {
  return SPOTIFY_CLIENT_ID;
}

/**
 * browser: this page is the speaker (Web Playback SDK). remote: it only controls another Spotify Connect device. There is
 * no setting for it: the player falls back to remote by itself when the browser cannot play. Only tests and tooling
 * set the stored value (end-to-end tests run without a Widevine player).
 */
export function getPlaybackMode(): 'browser' | 'remote' {
  return read(PLAYBACK_MODE_KEY) === 'remote' ? 'remote' : 'browser';
}

/** Reload the app so it picks up the stored preferences. */
export function reloadSettings(): void {
  location.reload();
}

/** Leaves the app for another page (Spotify's sign-in). A function of its own so tests can see where it would go. */
export function leaveFor(address: string): void {
  location.assign(address);
}

/** The address Spotify sends the browser back to after sign-in. Register exactly this in the Spotify dashboard. */
export function getRedirectUri(): string {
  return `${location.origin}/`;
}
