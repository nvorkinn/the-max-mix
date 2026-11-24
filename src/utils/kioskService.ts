// The kiosk's local service (pi/kiosk-audio/server.ts), which only answers the Pi's own browser, on its own address.
// The app uses it for what a page cannot do itself: listing the AirPlay speakers, routing the sound, the Wi-Fi, turning
// the screen on, restarting and rebooting the Pi, and updating it (which it streams back).
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

type UpdateState = 'pulling' | 'installing' | 'installed' | 'restarting' | 'done' | 'failed';

/**
 * What the kiosk sends while it updates (pi/kiosk-audio/update.ts): the journal's lines, and the steps it is at. An
 * image Pi sends installing, then installed (its message is the version waiting for a restart) or done.
 */
export type UpdateEvent =
  { type: 'log' | 'error'; line: string } | { type: 'status'; state: UpdateState; message?: string };

const STATES = new Set<string>(['pulling', 'installing', 'installed', 'restarting', 'done', 'failed']);

/** A frame from the kiosk as an event, or null for anything that is not one. */
export function parseUpdateEvent(data: unknown): UpdateEvent | null {
  if (typeof data !== 'string') return null;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if ((record['type'] === 'log' || record['type'] === 'error') && typeof record['line'] === 'string') {
    return { type: record['type'], line: record['line'] };
  }
  const state = record['state'];
  if (typeof state === 'string' && STATES.has(state) && record['type'] === 'status') {
    const message = record['message'];
    return {
      type: 'status',
      state: state as UpdateState,
      ...(typeof message === 'string' && { message })
    };
  }
  return null;
}

/**
 * Starts the update (a WebSocket to /power/update: connecting is what starts it) and reports what the kiosk sends.
 * `onClose` follows every end of the connection, including the one a restart of the kiosk causes. Returns the function
 * that stops listening and closes the connection.
 */
export function openUpdateStream(handlers: {
  onOpen: () => void;
  onEvent: (event: UpdateEvent) => void;
  onClose: () => void;
}): () => void {
  const socket = new WebSocket(`${KIOSK_SERVICE.replace(/^http/, 'ws')}/power/update`);
  let isListening = true;
  socket.addEventListener('open', () => {
    if (isListening) handlers.onOpen();
  });
  socket.addEventListener('message', message => {
    const event = parseUpdateEvent(message.data);
    if (isListening && event) handlers.onEvent(event);
  });
  socket.addEventListener('close', () => {
    if (isListening) handlers.onClose();
  });
  return () => {
    isListening = false;
    socket.close();
  };
}

/** What an image Pi's update channel has (pi/kiosk-audio/image-update.ts check). Versions are `<ref>+<commit>`. */
export interface ImageUpdateCheck {
  current: string | null;
  /** Installed in the other slot, waiting for a restart. */
  installed: string | null;
  /**
   * up-to-date, available (`latest` can be installed), installed, failed (`latest` failed its first boot here, so it is
   * not installed again), none (nothing published on the channel yet) or unreachable (offline).
   */
  result: 'up-to-date' | 'available' | 'installed' | 'failed' | 'none' | 'unreachable';
  latest: string | null;
}

const RESULTS = new Set<string>(['up-to-date', 'available', 'installed', 'failed', 'none', 'unreachable']);
const versionOrNull = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/** The kiosk's answer to POST /update/check, or null for anything else. */
export function parseImageCheck(body: unknown): ImageUpdateCheck | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  const result = record['result'];
  if (typeof result !== 'string' || !RESULTS.has(result)) return null;
  return {
    current: versionOrNull(record['current']),
    installed: versionOrNull(record['installed']),
    result: result as ImageUpdateCheck['result'],
    latest: versionOrNull(record['latest'])
  };
}

/**
 * Asks an image Pi what its update channel has. Null on a Pi Ansible installed (the service answers 404), and when the
 * service does not answer: the app then follows the Pi's version the old way.
 */
export async function checkImageUpdate(signal: AbortSignal | null = null): Promise<ImageUpdateCheck | null> {
  try {
    const response = await fetch(`${KIOSK_SERVICE}/update/check`, { method: 'POST', signal });
    return response.ok ? parseImageCheck(await response.json()) : null;
  } catch {
    return null;
  }
}
