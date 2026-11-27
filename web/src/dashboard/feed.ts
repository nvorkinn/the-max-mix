// countdown-server's live feed (countdown-api's getFeed, GET /api/devices/feed): the kiosk's weather, arrivals and
// notices as server-sent events, each sent as the stream opens and again whenever it changes. EventSource can't send
// the device secret (it has no headers), so the stream is read with fetch and parsed here.
//
// The server ends each stream after about ten minutes and pings every 15 s; openFeed opens the next one by itself, after
// the stream's `retry`. A stream that fails to open, breaks, or goes quiet for longer than SILENCE_MS is dropped and
// tried again with a growing wait, and the handlers hear `down` so the Dashboard can mark what it shows as stale. Only
// a failure is `down`: the server's own end of a stream isn't, so the ten-minute turnover never flickers the marker.

import type { DeviceArrivals, DeviceNotices, DeviceWeather } from 'countdown-api';
import { getFeedUrl } from '../../../vendor/countdown-api/src/countdown_api/client';
import type { Client } from '../../../vendor/countdown-api/src/countdown_api/client';
import { errorMessage } from '../utils/errorMessage';

/** One of the feed's events, by name, with what that route answers. */
export type FeedEvent =
  | { event: 'weather'; data: DeviceWeather }
  | { event: 'arrivals'; data: DeviceArrivals }
  | { event: 'notices'; data: DeviceNotices };

/** `open` once a stream has answered 200, `down` when one couldn't open or broke. */
export type FeedStatus = 'open' | 'down';

export interface FeedHandlers {
  onEvent: (event: FeedEvent) => void;
  onStatus: (status: FeedStatus, why?: string) => void;
}

/** Longer than the server's 15 s between pings, with room for a slow network: the stream has dropped. */
export const SILENCE_MS = 40_000;
/** The wait before the next stream when the server doesn't say (`retry`). */
const DEFAULT_RETRY_MS = 3000;
/** The waits after a failure, doubling from the first to the last. */
const FIRST_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60_000;
/** After 401 or 409 (the server doesn't know the kiosk, or nobody owns it yet), which won't change in seconds. */
const REFUSED_RETRY_MS = 60_000;

const EVENTS = new Set<string>(['weather', 'arrivals', 'notices']);

/** One message of an event stream: its event name, data and retry, as far as it has them. */
interface Message {
  event?: string;
  data?: string;
  retry?: number;
}

/**
 * The complete messages at the start of `text` (each ends with a blank line), and what is left over for the next chunk.
 * Comment lines (the server's pings) and fields the feed doesn't use are skipped.
 */
export function parseMessages(text: string): { messages: Message[]; rest: string } {
  const normalised = text.replaceAll(/\r\n?/g, '\n');
  const blocks = normalised.split('\n\n');
  const rest = blocks.pop() ?? '';
  const messages = blocks.flatMap(block => {
    const message: Message = {};
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line === '' || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') message.event = value;
      else if (field === 'data') data.push(value);
      else if (field === 'retry' && /^\d+$/.test(value)) message.retry = Number(value);
    }
    if (data.length > 0) message.data = data.join('\n');
    return Object.keys(message).length > 0 ? [message] : [];
  });
  return { messages, rest };
}

/** The message as one of the feed's events, or null for one it doesn't know or can't read. */
function toEvent(message: Message): FeedEvent | null {
  if (!message.event || !EVENTS.has(message.event) || message.data === undefined) return null;
  try {
    const data: unknown = JSON.parse(message.data);
    return { event: message.event, data } as FeedEvent;
  } catch {
    return null;
  }
}

class Refused extends Error {}

interface Timers {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const WINDOW_TIMERS: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: handle => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  }
};

/**
 * Reads the feed for `client` until the returned function is called, opening each next stream itself. `timers` is for
 * the tests.
 */
export function openFeed(client: Client, handlers: FeedHandlers, timers: Timers = WINDOW_TIMERS): () => void {
  const fetcher = client.fetch ?? ((input: string | URL | Request, init?: RequestInit) => fetch(input, init));
  let closed = false;
  let controller: AbortController | null = null;
  let pending: unknown = null;
  let retryMs = DEFAULT_RETRY_MS;
  let backoffMs = FIRST_BACKOFF_MS;

  const schedule = (ms: number) => {
    if (closed) return;
    pending = timers.setTimeout(() => {
      pending = null;
      void connect();
    }, ms);
  };

  async function connect(): Promise<void> {
    const attempt = new AbortController();
    controller = attempt;
    let silence: unknown = null;
    const quiet = () => {
      if (silence !== null) timers.clearTimeout(silence);
      silence = timers.setTimeout(() => {
        attempt.abort(new Error(`nothing from the feed for ${SILENCE_MS / 1000} s`));
      }, SILENCE_MS);
    };
    try {
      quiet();
      const response = await fetcher(getFeedUrl(client.baseUrl), {
        headers: { Authorization: `Bearer ${client.secret}`, Accept: 'text/event-stream' },
        cache: 'no-store',
        signal: attempt.signal
      });
      if (response.status === 401 || response.status === 409) throw new Refused(`the feed answered ${response.status}`);
      if (!response.ok || !response.body) throw new Error(`the feed answered ${response.status}`);
      handlers.onStatus('open');
      backoffMs = FIRST_BACKOFF_MS;
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        // One chunk at a time, in order: each read waits for the server's next.
        // eslint-disable-next-line no-await-in-loop -- a stream is read in order
        const { value, done } = await reader.read();
        if (done) break;
        quiet();
        const { messages, rest } = parseMessages(buffer + value);
        buffer = rest;
        for (const message of messages) {
          if (message.retry !== undefined) retryMs = message.retry;
          const event = toEvent(message);
          if (event) handlers.onEvent(event);
        }
      }
      // The server ended it (its ten minutes are up, or it is restarting): the next one opens shortly.
      schedule(retryMs);
    } catch (caught) {
      if (closed) return;
      const refused = caught instanceof Refused;
      handlers.onStatus('down', errorMessage(attempt.signal.aborted ? attempt.signal.reason : caught));
      schedule(refused ? REFUSED_RETRY_MS : backoffMs);
      if (!refused) backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    } finally {
      if (silence !== null) timers.clearTimeout(silence);
      if (controller === attempt) controller = null;
    }
  }

  void connect();
  return () => {
    closed = true;
    if (pending !== null) timers.clearTimeout(pending);
    controller?.abort(new Error('closed'));
  };
}
