import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { lrclib } from './lrclib';

const json = (body: unknown, status = 200) => Response.json(body, { status });
const notFound = () => json({ code: 404, name: 'TrackNotFound' }, 404);
const overloaded = () => json({ name: 'ServerOverloaded', statusCode: 503 }, 503);
const query = { title: 'Placeholder Song', artist: 'Placeholder Artist', durationMs: 200_400 };
const signal = () => new AbortController().signal;

describe('lyrics/lrclib', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const urlOf = (call = 0) => new URL(String(fetchMock.mock.calls[call]?.[0]));

  it('looks the track up by title, artist and length and prefers synced lyrics', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ instrumental: false, plainLyrics: 'Plain placeholder', syncedLyrics: '[00:01.00]Synced placeholder' })
    );
    await expect(lrclib(query, signal())).resolves.toEqual({
      kind: 'synced',
      lines: [{ timeMs: 1000, text: 'Synced placeholder' }],
      source: 'LRCLIB'
    });
    const url = urlOf();
    expect(url.origin + url.pathname).toBe('https://lrclib.net/api/get-cached');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      track_name: 'Placeholder Song',
      artist_name: 'Placeholder Artist',
      duration: '200'
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('Lrclib-Client')).toContain('THE MAX MIX');
  });

  it('passes the album when it is known and leaves out an unknown length', async () => {
    fetchMock.mockResolvedValueOnce(json({ instrumental: true }));
    await expect(lrclib({ title: 'T', artist: 'A', album: 'Placeholder Album' }, signal())).resolves.toEqual({
      kind: 'instrumental',
      source: 'LRCLIB'
    });
    expect(Object.fromEntries(urlOf().searchParams)).toEqual({
      track_name: 'T',
      artist_name: 'A',
      album_name: 'Placeholder Album'
    });
  });

  it('falls back to plain lyrics', async () => {
    fetchMock.mockResolvedValueOnce(json({ plainLyrics: 'Line one\r\n\r\n Line two ', syncedLyrics: '[00:01.00]' }));
    await expect(lrclib(query, signal())).resolves.toEqual({
      kind: 'plain',
      lines: ['Line one', '', 'Line two'],
      source: 'LRCLIB'
    });
  });

  it('searches when there is no exact match and takes the closest synced result of a similar length', async () => {
    fetchMock
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(
        json([
          'junk',
          { duration: 320, syncedLyrics: '[00:01.00]Other recording' },
          { duration: 201, plainLyrics: 'Plain placeholder' },
          { duration: 198, syncedLyrics: '[00:02.00]Synced placeholder' }
        ])
      );
    await expect(lrclib(query, signal())).resolves.toMatchObject({
      kind: 'synced',
      lines: [{ timeMs: 2000, text: 'Synced placeholder' }]
    });
    const url = urlOf(1);
    expect(url.pathname).toBe('/api/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      track_name: 'Placeholder Song',
      artist_name: 'Placeholder Artist'
    });
  });

  it('treats a 503 as not found and falls back to the search, then the live lookup', async () => {
    fetchMock
      .mockResolvedValueOnce(overloaded())
      .mockResolvedValueOnce(overloaded())
      .mockResolvedValueOnce(json({ syncedLyrics: '[00:01.00]Fetched placeholder' }));
    await expect(lrclib(query, signal())).resolves.toMatchObject({ kind: 'synced' });
    expect([0, 1, 2].map(call => urlOf(call).pathname)).toEqual(['/api/get-cached', '/api/search', '/api/get']);
    expect(Object.fromEntries(urlOf(2).searchParams)).toMatchObject({ duration: '200' });
  });

  it('resolves to null when every lookup answers 503', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(overloaded()));
    await expect(lrclib(query, signal())).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('searches when the exact match has no words and accepts plain results', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ plainLyrics: '  ' }))
      .mockResolvedValueOnce(json([{ plainLyrics: '' }, { plainLyrics: 'Plain placeholder' }]));
    await expect(lrclib({ title: 'T', artist: 'A' }, signal())).resolves.toMatchObject({ kind: 'plain' });
  });

  it('resolves to null when nothing is found', async () => {
    fetchMock
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(json({ unexpected: true }))
      .mockResolvedValueOnce(notFound());
    await expect(lrclib(query, signal())).resolves.toBeNull();
  });

  it('treats a body that is not JSON as no answer', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('oops'))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(notFound());
    await expect(lrclib(query, signal())).resolves.toBeNull();
  });

  it('rejects with a readable message when the service fails or cannot be reached', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 500));
    await expect(lrclib(query, signal())).rejects.toThrow('The lyrics service answered 500.');
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(lrclib(query, signal())).rejects.toThrow('Could not reach the lyrics service.');
  });

  it('passes a cancellation through unchanged', async () => {
    const controller = new AbortController();
    controller.abort();
    const abort = new DOMException('Aborted', 'AbortError');
    fetchMock.mockRejectedValueOnce(abort);
    await expect(lrclib(query, controller.signal)).rejects.toBe(abort);
  });
});
