// Settings that used to live in the server's environment. They are read from the browser's own storage, so the app
// needs no backend. Storage can be unavailable (private windows, blocked site data): every access tolerates that.

const CLIENT_ID_KEY = 'maxmix.clientId';
const PLAYBACK_MODE_KEY = 'maxmix.playbackMode';
const DEMO_KEY = 'maxmix.demo';

/** @param {string} key */
function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * @param {string} key
 * @param {string | null} value null removes the key
 */
function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage is unavailable; the setting then lasts only until the page reloads.
  }
}

/** The Spotify client ID: built in at build time (VITE_SPOTIFY_CLIENT_ID), else entered in Settings. Not a secret. */
export function getClientId() {
  /** @type {unknown} */
  const built = import.meta.env['VITE_SPOTIFY_CLIENT_ID'];
  return (typeof built === 'string' && built) || read(CLIENT_ID_KEY) || '';
}

/** @param {string} clientId */
export function setClientId(clientId) {
  write(CLIENT_ID_KEY, clientId.trim() || null);
}

/**
 * browser: this page is the speaker (Web Playback SDK). remote: it only controls another Spotify Connect device.
 * @returns {'browser' | 'remote'}
 */
export function getPlaybackMode() {
  return read(PLAYBACK_MODE_KEY) === 'remote' ? 'remote' : 'browser';
}

/** @param {'browser' | 'remote'} mode */
export function setPlaybackMode(mode) {
  write(PLAYBACK_MODE_KEY, mode === 'remote' ? 'remote' : null);
}

/** Demo mode simulates playback; it is on when the address has ?demo=true or it was switched on in Settings. */
export function isDemoMode() {
  return new URLSearchParams(location.search).get('demo') === 'true' || read(DEMO_KEY) === 'true';
}

/** @param {boolean} on */
export function setDemoMode(on) {
  write(DEMO_KEY, on ? 'true' : null);
}

/** The address Spotify sends the browser back to after sign-in. Register exactly this in the Spotify dashboard. */
export function getRedirectUri() {
  return `${location.origin}/`;
}
