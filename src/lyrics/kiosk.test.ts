import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { kioskLyrics } from './kiosk';

const query = { title: 'Placeholder Song', artist: 'Placeholder Artist', durationMs: 200_400 };
const signal = () => new AbortController().signal;
const LRC = '[00:01.00]First placeholder\n[00:02.50]Second placeholder';

describe('lyrics/kiosk', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('asks the kiosk service and parses the LRC it sends', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ source: 'NetEase', lrc: LRC }));
    await expect(kioskLyrics(query, signal())).resolves.toEqual({
      kind: 'synced',
      lines: [
        { timeMs: 1000, text: 'First placeholder' },
        { timeMs: 2500, text: 'Second placeholder' }
      ],
      source: 'NetEase'
    });
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe('http://127.0.0.1:7341/lyrics');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      title: 'Placeholder Song',
      artist: 'Placeholder Artist',
      duration: '200400'
    });
  });

  it('leaves the length out when it is not known, and names the kiosk when the source is missing', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ lrc: LRC }));
    const lyrics = await kioskLyrics({ title: 'A', artist: 'B' }, signal());
    expect(lyrics).toMatchObject({ source: 'Kiosk' });
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.has('duration')).toBe(false);
  });

  it('has no lyrics when the service has none, answers oddly, or is not there', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(kioskLyrics(query, signal())).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(Response.json({ lrc: 7 }));
    await expect(kioskLyrics(query, signal())).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(new Response('not json'));
    await expect(kioskLyrics(query, signal())).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(Response.json({ lrc: '[ar:Someone]' }));
    await expect(kioskLyrics(query, signal())).resolves.toBeNull();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(kioskLyrics(query, signal())).resolves.toBeNull();
  });

  it('fails when the service could not look, and passes a cancellation on', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 502 }));
    await expect(kioskLyrics(query, signal())).rejects.toThrow('The kiosk could not look up lyrics (502).');
    const controller = new AbortController();
    const abort = new DOMException('Aborted', 'AbortError');
    fetchMock.mockImplementationOnce(() => {
      controller.abort();
      return Promise.reject(abort);
    });
    await expect(kioskLyrics(query, controller.signal)).rejects.toBe(abort);
  });
});
