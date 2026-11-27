// The WebSocket at /power/update: connecting to it starts an update (see update.ts) and streams it to the app. It shares
// the service's HTTP server and port, and is answered to the app's origin alone: browsers do not apply CORS to a
// WebSocket, so without the check any web page could start an update. Other sockets (Soloist's, soloist-socket.ts) are
// served alongside it on their own paths, with the same checks.
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { isLoopback } from './hotspot-portal.ts';
import type { Send } from './update.ts';

const UPDATE_PATH = '/power/update';

export type Update = (send: Send, signal: AbortSignal) => Promise<void>;

function refuse(socket: Duplex, status: 403 | 404): void {
  socket.write(
    `HTTP/1.1 ${status} ${status === 403 ? 'Forbidden' : 'Not Found'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
  );
  socket.destroy();
}

/** Takes on one connection to another path. */
export type SocketRoute = (connection: WebSocket) => void;

/** Serves the update WebSocket on `server`, and `routes` on their paths. Only one update runs at a time. */
export function attachUpdateSocket(
  server: Server,
  origin: string,
  update: Update,
  routes: Readonly<Record<string, SocketRoute>> = {}
): void {
  // The app sends nothing to the update and only short commands to the other sockets, so nothing sizeable is accepted.
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  let isRunning = false;
  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!isLoopback(request.socket.localAddress)) {
      // Not from this machine: the hotspot's phones get the setup page and nothing else (hotspot-portal.ts).
      refuse(socket, 403);
    } else if (request.url !== UPDATE_PATH && !Object.hasOwn(routes, request.url ?? '')) {
      refuse(socket, 404);
    } else if (request.headers.origin !== origin) {
      refuse(socket, 403);
    } else if (request.url === UPDATE_PATH) {
      sockets.handleUpgrade(request, socket, head, connection => {
        const controller = new AbortController();
        const send: Send = message => {
          if (connection.readyState === connection.OPEN) connection.send(JSON.stringify(message));
        };
        // The app going away (or the restart ending its browser) stops the streaming, and with it the journal followers.
        connection.on('close', () => {
          controller.abort();
        });
        connection.on('error', () => {
          controller.abort();
        });
        if (isRunning) {
          send({ type: 'status', state: 'failed', message: 'An update is already running.' });
          connection.close(1000);
          return;
        }
        isRunning = true;
        void (async () => {
          try {
            await update(send, controller.signal);
          } catch (error) {
            send({ type: 'status', state: 'failed', message: String(error) });
          } finally {
            isRunning = false;
            connection.close(1000);
          }
        })();
      });
    } else {
      const route = routes[request.url ?? ''];
      sockets.handleUpgrade(request, socket, head, connection => {
        route?.(connection);
      });
    }
  });
}
