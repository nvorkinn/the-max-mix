// Whether lyrics are shown in place of the artwork; remembered so the kiosk comes back the way it was left. Storage can
// be unavailable: every access tolerates that. The key predates the `maxmix.` naming and is kept so saved choices stay.

const LYRICS_KEY = 'maxmix_lyrics';

export function loadShowLyrics(): boolean {
  try {
    return localStorage.getItem(LYRICS_KEY) === 'on';
  } catch {
    return false;
  }
}

export function saveShowLyrics(show: boolean): void {
  try {
    localStorage.setItem(LYRICS_KEY, show ? 'on' : 'off');
  } catch {
    // Storage is unavailable; the choice then lasts only until the page reloads.
  }
}
