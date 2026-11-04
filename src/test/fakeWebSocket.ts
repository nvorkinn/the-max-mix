/**
 * A stand-in for the browser's WebSocket (stub it with vi.stubGlobal('WebSocket', FakeWebSocket)): the test decides when
 * it opens, what it receives and when the server ends it. Every one made is kept, newest last.
 */
const sockets: FakeWebSocket[] = [];

export function resetFakeSockets(): void {
  sockets.length = 0;
}

/** The newest WebSocket the code under test opened. */
export function latestFakeSocket(): FakeWebSocket {
  const socket = sockets.at(-1);
  if (!socket) throw new Error('No WebSocket was opened');
  return socket;
}

export function fakeSocketCount(): number {
  return sockets.length;
}

export class FakeWebSocket {
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();
  readonly url: string;
  isClosed = false;

  constructor(url: string) {
    this.url = url;
    sockets.push(this);
  }

  private emit(type: string, event: unknown = {}): void {
    const listeners = this.listeners.get(type) ?? [];
    for (const listener of listeners) listener(event);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  /** The connection is made. */
  open(): void {
    this.emit('open');
  }

  /** The server sends a frame (an object is sent as JSON). */
  receive(frame: unknown): void {
    this.emit('message', { data: typeof frame === 'string' ? frame : JSON.stringify(frame) });
  }

  /** The server (or the network) ends the connection. */
  end(): void {
    this.isClosed = true;
    this.emit('close');
  }

  /** The page closes it. */
  close(): void {
    this.isClosed = true;
    this.emit('close');
  }
}
