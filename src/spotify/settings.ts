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
 * browser: the kiosk is the speaker, through its own player (Spotify Soloist, which the Pi runs). remote: the page only
 * controls another Spotify Connect device, as it does anywhere but on the kiosk, which has no player of its own. There
 * is no setting for it: only tests and tooling set the stored value (end-to-end tests mostly run without the Pi).
 */
export function getPlaybackMode(): 'browser' | 'remote' {
  return isOnKiosk() && read(PLAYBACK_MODE_KEY) !== 'remote' ? 'browser' : 'remote';
}

/**
 * Whether this is the Pi kiosk, as utils/kiosk.ts's isKiosk says it (?kiosk=1 or 0, else the flag it keeps), without
 * remembering anything. Not imported from there: the end-to-end tests load this file in Node, which needs every import
 * to name its file, and kiosk.ts's imports don't.
 */
function isOnKiosk(): boolean {
  const flag = new URLSearchParams(location.search).get('kiosk');
  return flag === '1' || (flag !== '0' && read('maxmix.kiosk') === 'true');
}

/** Reload the app so it picks up the stored preferences. */
export function reloadSettings(): void {
  location.reload();
}

/**
 * Leaves the app for another page (Spotify's sign-in, countdown-server's /register). A function of its own so tests can
 * see where it would go. With no network it stays: the kiosk would be left on Chromium's error page, with no way back.
 */
export function leaveFor(address: string): void {
  if (!navigator.onLine) {
    console.warn(`Offline, so the app stays instead of going to ${new URL(address).origin}`);
    return;
  }
  location.assign(address);
}

/** The address Spotify sends the browser back to after sign-in. Register exactly this in the Spotify dashboard. */
export function getRedirectUri(): string {
  return `${location.origin}/`;
}
