// Settings that used to live in the server's environment. They are read from the browser's own storage, so the app
// needs no backend. Storage can be unavailable (private windows, blocked site data): every access tolerates that.

const PLAYBACK_MODE_KEY = 'maxmix.playbackMode';
const DEMO_KEY = 'maxmix.demo';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** A null value removes the key. */
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage is unavailable; the setting then lasts only until the page reloads.
  }
}

/** The Spotify client ID, built in at build time (VITE_SPOTIFY_CLIENT_ID, defaulted in the committed .env). Not a secret. */
export function getClientId(): string {
  const built: unknown = import.meta.env['VITE_SPOTIFY_CLIENT_ID'];
  return typeof built === 'string' ? built.trim() : '';
}

/** browser: this page is the speaker (Web Playback SDK). remote: it only controls another Spotify Connect device. */
export function getPlaybackMode(): 'browser' | 'remote' {
  return read(PLAYBACK_MODE_KEY) === 'remote' ? 'remote' : 'browser';
}

export function setPlaybackMode(mode: 'browser' | 'remote'): void {
  write(PLAYBACK_MODE_KEY, mode === 'remote' ? 'remote' : null);
}

/** Demo mode simulates playback; it is on when the address has ?demo=true or it was switched on in Settings. */
export function isDemoMode(): boolean {
  return new URLSearchParams(location.search).get('demo') === 'true' || read(DEMO_KEY) === 'true';
}

export function setDemoMode(on: boolean): void {
  write(DEMO_KEY, on ? 'true' : null);
}

/** The address Spotify sends the browser back to after sign-in. Register exactly this in the Spotify dashboard. */
export function getRedirectUri(): string {
  return `${location.origin}/`;
}
