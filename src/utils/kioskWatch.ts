// On the Pi kiosk, tells the kiosk service (pi/kiosk-audio/watchdog.ts) that the page is alive, so it can restart Chromium
// when the tab crashes, the page hangs or the app goes blank; and copies the app's errors to the Pi's journal
// (journalctl _SYSTEMD_USER_UNIT=kiosk-audio.service), where they survive that restart. Both are best effort and silent:
// a failure here must not log anything, or an error about the kiosk service would be sent to the kiosk service again.
import { getDebugEntries, subscribeDebugLog } from './debugLog';
import { KIOSK_SERVICE } from './kioskService';

export const HEARTBEAT_MS = 20_000;

function send(path: string, body?: unknown): void {
  const init: RequestInit =
    body === undefined
      ? { method: 'POST' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  fetch(`${KIOSK_SERVICE}${path}`, init).catch(() => {
    // The service is restarting, or this is not the Pi.
  });
}

/** True while the app shows something: a render error unmounts everything and leaves #root empty. */
const isShowing = (): boolean => (document.querySelector('#root')?.childElementCount ?? 0) > 0;

/** Starts the heartbeat and the error copy. Returns the function that stops both. */
export function startKioskWatch(): () => void {
  const timer = setInterval(() => {
    if (isShowing()) send('/heartbeat');
  }, HEARTBEAT_MS);

  // Errors only (from the start of the page), each once: a repeat of the last entry bumps its counter, not its id.
  let lastId = 0;
  const copyErrors = () => {
    for (const entry of getDebugEntries()) {
      if (entry.id <= lastId) continue;
      lastId = entry.id;
      if (entry.level === 'error') send('/log', { level: entry.level, source: entry.source, message: entry.message });
    }
  };
  copyErrors();
  const unsubscribe = subscribeDebugLog(copyErrors);

  return () => {
    clearInterval(timer);
    unsubscribe();
  };
}
