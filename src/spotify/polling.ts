// Whether the app reads Spotify by itself, on a timer. On by default; the debug console can turn it off, for example to
// save the account's quota. Turned off, playback is read once when the page opens and after each button press instead of
// every few seconds. Storage can be unavailable: every access tolerates that.

const POLL_KEY = 'maxmix.pollSpotify';
const listeners = new Set<() => void>();

export function getPollSpotify(): boolean {
  try {
    return localStorage.getItem(POLL_KEY) !== 'off';
  } catch {
    return true;
  }
}

let current = getPollSpotify();

export function setPollSpotify(on: boolean): void {
  current = on;
  try {
    if (on) localStorage.removeItem(POLL_KEY);
    else localStorage.setItem(POLL_KEY, 'off');
  } catch {
    // Storage is unavailable; the setting then lasts only until the page reloads.
  }
  for (const listener of listeners) listener();
}

/** The setting as it is now (kept in memory, so a change reaches every part of the page at once). */
export const getPollSpotifyNow = () => current;

export function subscribePollSpotify(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
