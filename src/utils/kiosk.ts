// The Raspberry Pi kiosk opens the app with ?kiosk=1. The flag is remembered in the browser's storage so it survives the
// Spotify sign-in redirect, which returns to the plain redirect address without the query. Storage can be unavailable
// (private windows, blocked site data): every access tolerates that.

const KIOSK_KEY = 'maxmix.kiosk';

/** The Wi-Fi setup page that runs on the Pi itself. A constant, so nothing a visitor types can change where it leads. */
export const WIFI_PORTAL_URL = 'http://127.0.0.1:8088/';

function read(): boolean {
  try {
    return localStorage.getItem(KIOSK_KEY) === 'true';
  } catch {
    return false;
  }
}

function write(on: boolean): void {
  try {
    if (on) localStorage.setItem(KIOSK_KEY, 'true');
    else localStorage.removeItem(KIOSK_KEY);
  } catch {
    // Storage is unavailable; the flag then lasts only until the page reloads.
  }
}

/** True on the Pi kiosk. ?kiosk=1 in the address remembers that, ?kiosk=0 forgets it; any other address changes nothing. */
export function isKiosk(): boolean {
  const flag = new URLSearchParams(location.search).get('kiosk');
  if (flag === '1') write(true);
  else if (flag === '0') write(false);
  return flag === '1' || (flag !== '0' && read());
}
