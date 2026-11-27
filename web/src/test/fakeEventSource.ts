/**
 * A stand-in for the browser's EventSource (stub it with vi.stubGlobal('EventSource', FakeEventSource)): the test decides
 * when the stream opens, what it sends and when it fails. Every one made is kept, newest last.
 */
const streams: FakeEventSource[] = [];

export function resetFakeEventSources(): void {
  streams.length = 0;
}

/** The newest stream the code under test opened. */
export function latestFakeEventSource(): FakeEventSource {
  const stream = streams.at(-1);
  if (!stream) throw new Error('No EventSource was opened');
  return stream;
}

export class FakeEventSource {
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();
  readonly url: string;
  isClosed = false;

  constructor(url: string) {
    this.url = url;
    streams.push(this);
  }

  private emit(type: string, event: unknown = {}): void {
    const listeners = this.listeners.get(type) ?? [];
    for (const listener of listeners) listener(event);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  /** The stream is open. */
  open(): void {
    this.emit('open');
  }

  /** The server sends an event (an object is sent as JSON). */
  receive(data: unknown): void {
    this.emit('message', { data: typeof data === 'string' ? data : JSON.stringify(data) });
  }

  /** The stream drops (the browser would try again). */
  fail(): void {
    this.emit('error');
  }

  /** The page closes it. */
  close(): void {
    this.isClosed = true;
  }
}
