import type { Page, WebSocketRoute } from '@playwright/test';
import type { SpotifyDevice } from '../src/types.ts';
import { KIOSK_SERVICE } from '../src/utils/kioskService.ts';

const SOLOIST_SOCKET = `${KIOSK_SERVICE.replace(/^http/, 'ws')}/soloist`;

/** Spotify Soloist as Spotify lists it, under the name the Pi's service gives it (pi/kiosk-audio/soloist.ts). */
const SOLOIST_DEVICE: SpotifyDevice = {
  id: 'soloist-device',
  name: 'The Max Mix Soloist',
  type: 'Speaker',
  is_active: false,
  is_restricted: false,
  supports_volume: true,
  volume_percent: 80
};

const send = (ws: WebSocketRoute, message: object) => {
  ws.send(JSON.stringify(message));
};

/**
 * Makes the page the kiosk with its own player, Spotify Soloist, as the Pi runs it: the service's /soloist WebSocket
 * (pi/kiosk-audio/soloist-socket.ts) says Soloist is there and signed in, and the fake Spotify account (`spotify`, from
 * fakeSpotify, which this is called after) lists it as a device. Soloist never becomes the active device here, so every
 * command still goes to the fake account through the Web API, which keeps its state. Tests make the service say Soloist
 * went away, and count the page's connections (a reconnect makes another).
 */
export async function fakeSoloist(page: Page, spotify: { devices: SpotifyDevice[] }) {
  spotify.devices.push({ ...SOLOIST_DEVICE });
  const connections: WebSocketRoute[] = [];
  await page.routeWebSocket(SOLOIST_SOCKET, ws => {
    connections.push(ws);
    send(ws, { type: 'bridge', connected: true });
    ws.onMessage(text => {
      const { command } = JSON.parse(String(text)) as { command?: string };
      if (command === 'get_state') {
        send(ws, { type: 'auth_state', logged_in: true, is_active: false, device_name: SOLOIST_DEVICE.name });
      } else if (command !== undefined) {
        send(ws, { type: 'command_result', command });
      }
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem('maxmix.kiosk', 'true');
    localStorage.setItem('maxmix.playbackMode', 'browser');
  });
  return {
    /** How many times the page has connected to Soloist. */
    connections: () => connections.length,
    /** The service says Soloist went away, as when it stops. */
    lose: () => {
      const latest = connections.at(-1);
      if (latest) send(latest, { type: 'bridge', connected: false });
    }
  };
}
