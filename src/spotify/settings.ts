// The app's settings, kept in the browser's own storage, so the app needs no backend. Storage can be unavailable
// (private windows, blocked site data): every access tolerates that.

// The app's Spotify client ID. It is public by design (sign-in uses PKCE and there is no client secret), so it lives in the
// code and users never enter it.
const SPOTIFY_CLIENT_ID = '79012ca710ca4dd5ad18c2973510b670';
const PLAYBACK_MODE_KEY = 'maxmix.playbackMode';
const AUDIO_ROUTE_KEY = 'maxmix.audioRoute';

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

export function getClientId(): string {
  return SPOTIFY_CLIENT_ID;
}

/** browser: this page is the speaker (Web Playback SDK). remote: it only controls another Spotify Connect device. */
export function getPlaybackMode(): 'browser' | 'remote' {
  return read(PLAYBACK_MODE_KEY) === 'remote' ? 'remote' : 'browser';
}

export function setPlaybackMode(mode: 'browser' | 'remote'): void {
  write(PLAYBACK_MODE_KEY, mode === 'remote' ? 'remote' : null);
}

/**
 * Where the kiosk's sound goes. spotify-connect: Spotify plays on this tablet or on a Spotify Connect speaker it is moved
 * to. airplay: Spotify plays on this tablet and the Pi sends the sound on to AirPlay speakers (the Pi's audio service).
 */
export type AudioRoute = 'spotify-connect' | 'airplay';

export function getAudioRoute(): AudioRoute {
  return read(AUDIO_ROUTE_KEY) === 'airplay' ? 'airplay' : 'spotify-connect';
}

export function setAudioRoute(route: AudioRoute): void {
  write(AUDIO_ROUTE_KEY, route === 'airplay' ? 'airplay' : null);
}

/** Reload the app so it picks up the stored preferences. */
export function reloadSettings(): void {
  location.reload();
}

/** The address Spotify sends the browser back to after sign-in. Register exactly this in the Spotify dashboard. */
export function getRedirectUri(): string {
  return `${location.origin}/`;
}
