// Carries the app's saved data over when the kiosk moves from the hosted app to the copy the Pi serves itself
// (pi/kiosk-audio/handover.ts). The browser keeps localStorage per origin, so the people, their Spotify logins and the
// countdown device secret would otherwise stay on the hosted origin. On the kiosk, the hosted app hands its items to the
// kiosk service at every start and then every few minutes; the local copy takes them once, before anything reads them.
import { KIOSK_SERVICE } from './kioskService';

const PREFIX = 'maxmix.';
/** Set once the local copy has taken the handover (or found none), so it is never taken twice. */
export const TAKEN_KEY = 'maxmix.handoverTaken';
/** Items that only matter to the page that wrote them. */
const LEFT_BEHIND = new Set(['maxmix.pkce', 'maxmix.httpLog', 'maxmix.storageCheck', TAKEN_KEY]);
const SEND_EVERY_MS = 10 * 60 * 1000;

/** Whether this page is the copy the Pi serves itself. */
export function isLocalCopy(origin = location.origin): boolean {
  return origin === KIOSK_SERVICE;
}

/** The app's items in `storage` that go over. */
export function handoverItems(storage: Storage): Record<string, string> {
  const items: Record<string, string> = {};
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(PREFIX) || LEFT_BEHIND.has(key)) continue;
    const value = storage.getItem(key);
    if (value !== null) items[key] = value;
  }
  return items;
}

/** The hosted app on the kiosk: hands its items to the kiosk service now, and again every few minutes. */
export function startHandover(storage: Storage = localStorage): void {
  if (isLocalCopy()) return;
  const send = async () => {
    try {
      await fetch(`${KIOSK_SERVICE}/handover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: handoverItems(storage) })
      });
    } catch {
      // The service or storage not there: the next round tries again.
    }
  };
  void send();
  setInterval(() => void send(), SEND_EVERY_MS);
}

/**
 * The local copy on its first start: takes the hosted app's items, keeping any it already has, then has the service
 * delete them. Resolves when that is done; when the service does not answer, it tries again at the next start.
 */
export async function takeHandover(storage: Storage = localStorage, origin = location.origin): Promise<void> {
  if (!isLocalCopy(origin)) return;
  try {
    if (storage.getItem(TAKEN_KEY)) return;
    const response = await fetch(`${KIOSK_SERVICE}/handover`);
    if (response.ok) {
      const body = (await response.json()) as { items?: Record<string, unknown> };
      for (const [key, value] of Object.entries(body.items ?? {})) {
        if (key.startsWith(PREFIX) && typeof value === 'string' && storage.getItem(key) === null) {
          storage.setItem(key, value);
        }
      }
    } else if (response.status !== 404) {
      return;
    }
    storage.setItem(TAKEN_KEY, '1');
    if (response.ok) await fetch(`${KIOSK_SERVICE}/handover/done`, { method: 'POST' });
  } catch {
    // Storage or the service not there: the next start tries again.
  }
}
