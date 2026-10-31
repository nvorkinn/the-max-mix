// The kiosk's local service (pi/kiosk-audio/server.ts), which only answers the Pi's own browser, on its own address.
// The app uses it for what a page cannot do itself: listing the AirPlay speakers, routing the sound, showing the Wi-Fi
// panel, turning the screen on, and updating, restarting and rebooting the Pi.
export const KIOSK_SERVICE = 'http://127.0.0.1:7341';

/**
 * Asks the kiosk to do something, without waiting: the buttons that call this have nothing to show until it happens
 * (a restart ends the page). A failure is logged; it is not a reason to interrupt the person.
 */
export function kioskPost(path: string, body?: unknown): void {
  const init: RequestInit =
    body === undefined
      ? { method: 'POST' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  fetch(`${KIOSK_SERVICE}${path}`, init)
    .then(response => {
      if (!response.ok) console.warn(`The kiosk refused ${path} (${response.status})`);
    })
    .catch((error: unknown) => console.warn(`The kiosk did not answer ${path}`, error));
}

/** How the update the person asked for is going (GET /update/status): see pi/kiosk-audio/actions.ts. */
export interface UpdateStatus {
  state: 'idle' | 'running' | 'done' | 'failed';
  lines: string[];
  total: number;
}

/** The update's status, or null when the service does not answer (it ends with the kiosk when an update restarts it). */
export async function getUpdateStatus(): Promise<UpdateStatus | null> {
  try {
    const response = await fetch(`${KIOSK_SERVICE}/update/status`, { cache: 'no-store' });
    return response.ok ? ((await response.json()) as UpdateStatus) : null;
  } catch {
    return null;
  }
}
