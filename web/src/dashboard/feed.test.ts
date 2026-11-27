// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '../../../vendor/countdown-api/src/countdown_api/client';
import { openFeed, parseMessages, SILENCE_MS } from './feed';
import type { FeedEvent, FeedStatus } from './feed';

const encoder = new TextEncoder();

/** A stream the test writes chunks to, and ends or breaks. */
function stream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    }
  });
  return {
    body,
    write: (text: string) => {
      controller.enqueue(encoder.encode(text));
    },
    end: () => {
      controller.close();
    },
    fail: () => {
      controller.error(new Error('connection reset'));
    }
  };
}

/** A client whose fetch answers each call with the next of `answers` (a stream or a status). */
function feedClient(answers: (ReturnType<typeof stream> | number)[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: input instanceof Request ? input.url : input.toString(), init });
    const answer = answers.shift();
    if (answer === undefined) return new Promise<Response>(() => {});
    if (typeof answer === 'number') return Promise.resolve(new Response(null, { status: answer }));
    // An abort ends the answer as it would a real one.
    init?.signal?.addEventListener('abort', () => {
      answer.fail();
    });
    return Promise.resolve(new Response(answer.body, { headers: { 'Content-Type': 'text/event-stream' } }));
  });
  const client: Client = { baseUrl: 'https://api.countdown.build', secret: 'device-secret', fetch };
  return { client, calls, fetch };
}

function listen() {
  const events: FeedEvent[] = [];
  const statuses: FeedStatus[] = [];
  return {
    events,
    statuses,
    handlers: {
      onEvent: (event: FeedEvent) => {
        events.push(event);
      },
      onStatus: (status: FeedStatus) => {
        statuses.push(status);
      }
    }
  };
}

const ARRIVALS = { stops: [] };

describe('parseMessages', () => {
  it('reads whole messages and keeps a part one for the next chunk', () => {
    const { messages, rest } = parseMessages(
      'retry: 3000\n\n: ping\n\nevent: arrivals\ndata: {"stops":[]}\n\nevent: wea'
    );
    expect(messages).toEqual([{ retry: 3000 }, { event: 'arrivals', data: '{"stops":[]}' }]);
    expect(rest).toBe('event: wea');
  });

  it('reads CRLF line ends and data over several lines', () => {
    expect(parseMessages('event: notices\r\ndata: {"a":\r\ndata: 1}\r\n\r\n').messages).toEqual([
      { event: 'notices', data: '{"a":\n1}' }
    ]);
  });

  it('skips comments and fields it does not use', () => {
    expect(parseMessages(': ping\n\nid: 7\n\n').messages).toEqual([]);
  });
});

describe('openFeed', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the feed with the device secret and hands on each event, split across chunks or not', async () => {
    const answer = stream();
    const { client, calls } = feedClient([answer]);
    const { events, statuses, handlers } = listen();
    const close = openFeed(client, handlers);

    answer.write('retry: 3000\n\nevent: arrivals\ndata: {"stops"');
    answer.write(':[]}\n\nevent: nonsense\ndata: {}\n\nevent: notices\ndata: not json\n\n');
    await vi.waitFor(() => {
      expect(events).toEqual([{ event: 'arrivals', data: ARRIVALS }]);
    });
    expect(statuses).toEqual(['open']);
    expect(calls[0]?.url).toBe('https://api.countdown.build/api/devices/feed');
    expect(new Headers(calls[0]?.init?.headers).get('Authorization')).toBe('Bearer device-secret');
    close();
  });

  it("opens the next stream after the server's retry when one ends, without saying it went down", async () => {
    vi.useFakeTimers();
    const first = stream();
    const second = stream();
    const { client, fetch } = feedClient([first, second]);
    const { events, statuses, handlers } = listen();
    const close = openFeed(client, handlers);

    first.write('retry: 5000\n\n');
    first.end();
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    second.write('event: arrivals\ndata: {"stops":[]}\n\n');
    await vi.advanceTimersByTimeAsync(0);

    expect(events).toHaveLength(1);
    expect(statuses).toEqual(['open', 'open']);
    close();
  });

  it('says it went down when a stream breaks or fails to open, and tries again with a growing wait', async () => {
    vi.useFakeTimers();
    const first = stream();
    const { client, fetch } = feedClient([first, 503, 503, stream()]);
    const { statuses, handlers } = listen();
    const close = openFeed(client, handlers);

    await vi.advanceTimersByTimeAsync(0);
    first.fail();
    await vi.advanceTimersByTimeAsync(2000); // the first wait
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3999); // the second, twice as long
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(8000);

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(statuses).toEqual(['open', 'down', 'down', 'down', 'open']);
    close();
  });

  it('drops a stream that goes quiet, pings counting as news', async () => {
    vi.useFakeTimers();
    const first = stream();
    const { client, fetch } = feedClient([first, stream()]);
    const { statuses, handlers } = listen();
    const close = openFeed(client, handlers);

    await vi.advanceTimersByTimeAsync(SILENCE_MS - 1000);
    first.write(': ping\n\n');
    await vi.advanceTimersByTimeAsync(SILENCE_MS - 1000);
    expect(statuses).toEqual(['open']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(statuses).toEqual(['open', 'down']);
    await vi.advanceTimersByTimeAsync(2000);

    expect(fetch).toHaveBeenCalledTimes(2);
    close();
  });

  it('waits a minute after a refusal (unknown or unowned kiosk)', async () => {
    vi.useFakeTimers();
    const { client, fetch } = feedClient([409, stream()]);
    const { statuses, handlers } = listen();
    const close = openFeed(client, handlers);

    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(statuses).toEqual(['down', 'open']);
    close();
  });

  it('stops reading and never opens another once closed', async () => {
    vi.useFakeTimers();
    const first = stream();
    const { client, fetch } = feedClient([first]);
    const { statuses, handlers } = listen();
    const close = openFeed(client, handlers);
    await vi.advanceTimersByTimeAsync(0);

    close();
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(['open']);
  });
});
