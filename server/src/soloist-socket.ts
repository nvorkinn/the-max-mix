// The WebSocket at /soloist: the app's line to Spotify Soloist, the Spotify Connect player this service runs for the
// active person (soloist.ts). Soloist's own WebSocket API (--ws 127.0.0.1:7342) checks nothing, so the app never talks to
// it directly: it connects here, on the service's origin-checked socket, and this passes Soloist's events on to every
// app connection and only well-formed commands back. Soloist restarts (a new build, a new key, another person) close its
// socket; this connects again on its own, and tells the app whether Soloist is there with {"type": "bridge"} messages.
import { WebSocket } from 'ws';
import type { RawData } from 'ws';

export const SOLOIST_PATH = '/soloist';
// The --ws address soloist.ts starts Soloist with.
const SOLOIST_URL = 'ws://127.0.0.1:7342';
/** How long to wait before connecting to Soloist again once it went away (or was not running). */
const SOLOIST_RETRY_MS = 3000;

// The commands of Soloist's WebSocket API (developer.spotify.com/documentation/soloist/reference/websocket-api).
const COMMANDS = new Set([
  'play',
  'pause',
  'skip_next',
  'skip_prev',
  'seek',
  'set_volume',
  'set_shuffle',
  'set_repeat_context',
  'set_repeat_track',
  'get_queue',
  'add_to_queue',
  'activate',
  'deactivate',
  'get_state',
  'get_auth_state'
]);

/** A message from the app, as passed on to Soloist; null when it is not one of Soloist's commands. */
export function soloistCommand(text: string): string | null {
  let message: unknown;
  try {
    message = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return null;
  const { type, command } = message as Record<string, unknown>;
  const isCommand = type === 'command' && typeof command === 'string' && COMMANDS.has(command);
  return isCommand ? JSON.stringify(message) : null;
}

/** A WebSocket message's text, whichever form `ws` handed it over in. */
function textOf(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return (Buffer.isBuffer(data) ? data : Buffer.from(new Uint8Array(data))).toString('utf8');
}

const bridgeMessage = (isConnected: boolean) => JSON.stringify({ type: 'bridge', connected: isConnected });

function send(socket: WebSocket, text: string): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(text);
}

type Connect = (url: string) => WebSocket;

/** Joins the app's connections to Soloist's WebSocket, which it keeps open while any app connection is. */
export class SoloistBridge {
  readonly #apps = new Set<WebSocket>();
  readonly #url: string;
  readonly #connect: Connect;
  readonly #retryMs: number;
  #soloist: WebSocket | null = null;
  #retry: ReturnType<typeof setTimeout> | undefined;

  constructor(options: { url?: string; connect?: Connect; retryMs?: number } = {}) {
    this.#url = options.url ?? SOLOIST_URL;
    this.#connect = options.connect ?? (url => new WebSocket(url));
    this.#retryMs = options.retryMs ?? SOLOIST_RETRY_MS;
  }

  #open(): void {
    this.#retry = undefined;
    const soloist = this.#connect(this.#url);
    this.#soloist = soloist;
    soloist.on('open', () => {
      this.#broadcast(bridgeMessage(true));
    });
    soloist.on('message', data => {
      this.#broadcast(textOf(data));
    });
    soloist.on('error', () => {
      // A close follows, which connects again.
    });
    soloist.on('close', () => {
      if (this.#soloist !== soloist) return;
      this.#soloist = null;
      this.#broadcast(bridgeMessage(false));
      if (this.#apps.size > 0) {
        this.#retry = setTimeout(() => {
          this.#open();
        }, this.#retryMs);
      }
    });
  }

  #stop(): void {
    clearTimeout(this.#retry);
    this.#retry = undefined;
    const soloist = this.#soloist;
    this.#soloist = null;
    soloist?.close();
  }

  #broadcast(text: string): void {
    for (const app of this.#apps) send(app, text);
  }

  /** Takes on one app connection until it closes. */
  add(app: WebSocket): void {
    this.#apps.add(app);
    app.on('message', data => {
      const command = soloistCommand(textOf(data));
      if (command === null) {
        send(app, JSON.stringify({ type: 'error', message: 'not a Soloist command' }));
      } else if (this.#soloist?.readyState === WebSocket.OPEN) {
        this.#soloist.send(command);
      } else {
        send(app, JSON.stringify({ type: 'error', message: 'Soloist is not running' }));
      }
    });
    const leave = () => {
      this.#apps.delete(app);
      if (this.#apps.size === 0) this.#stop();
    };
    app.on('close', leave);
    app.on('error', leave);
    send(app, bridgeMessage(this.#soloist?.readyState === WebSocket.OPEN));
    if (!this.#soloist && this.#retry === undefined) this.#open();
  }
}
