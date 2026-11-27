// Whether Spotify Soloist, the kiosk's own Spotify player (soloistPlayer.ts), is signed in. A person's key only lets
// Soloist start: it signs in to their Spotify account the first time they pick it in Spotify's device list on their
// phone, and keeps that session in their data folder on the Pi from then on. Soloist says where it stands with an
// auth_state, which the first-time setup waits for (components/setup/SetupWizard.tsx).

import { isRecord } from './parse';
import { RECONNECT_MS, SOLOIST_SOCKET } from './soloistPlayer';

/** What Soloist says of its sign-in. */
export interface SoloistAuth {
  isSignedIn: boolean;
  /** The name it goes by in Spotify's device list, which the Pi's service picks for each kiosk. */
  deviceName: string | null;
}

/**
 * Tells `onAuth` every time Soloist says whether it is signed in, over the kiosk service's WebSocket, which it keeps
 * connecting to (Soloist only starts once the person's key is there). Returns the function that stops it.
 */
export function watchSoloistAuth(onAuth: (auth: SoloistAuth) => void, url = SOLOIST_SOCKET): () => void {
  let socket: WebSocket | null = null;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let isStopped = false;
  const receive = (from: WebSocket, data: unknown) => {
    let message: unknown;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
    if (!isRecord(message)) return;
    if (message['type'] === 'bridge' && message['connected'] === true) {
      // Soloist greets a connection of its own with its sign-in; one joined to the service's asks for it.
      from.send(JSON.stringify({ type: 'command', command: 'get_auth_state' }));
    } else if (message['type'] === 'auth_state') {
      const name = message['device_name'];
      onAuth({ isSignedIn: message['logged_in'] === true, deviceName: typeof name === 'string' ? name : null });
    }
  };
  const open = () => {
    reconnect = undefined;
    const current = new WebSocket(url);
    socket = current;
    current.addEventListener('message', message => {
      if (socket === current) receive(current, message.data);
    });
    current.addEventListener('close', () => {
      if (socket !== current) return;
      socket = null;
      if (!isStopped) reconnect = setTimeout(open, RECONNECT_MS);
    });
  };
  open();
  return () => {
    isStopped = true;
    clearTimeout(reconnect);
    const current = socket;
    socket = null;
    current?.close();
  };
}
