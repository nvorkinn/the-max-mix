import { describe, expect, it, vi } from 'vitest';
import { lrclibSource, lyricsfileToLrc } from './lyrics-lrclib.ts';
import { HttpError, SourceResting } from './lyrics-sources.ts';
import type { GetJson } from './lyrics-sources.ts';

const query = { title: 'Placeholder Song', artist: 'Placeholder Artist', durationMs: 200_400 };
const LYRICSFILE = `version: '1.0'
metadata:
  title: Placeholder Song
lines:
- text: Placeholder words here
  start_ms: 61000
  end_ms: 63500
  words:
  - text: 'Placeholder '
    start_ms: 61000
  - text: 'words '
    start_ms: 61500
  - text: here
    start_ms: 62200
- text: It's again
  start_ms: 65000
  words:
  - text: 'It''s '
    start_ms: 65000
    end_ms: 65300
  - text: again
    start_ms: 65400
    end_ms: 66000
- text: No words
  start_ms: 70000
- text: No time
`;
const song = {
  id: 7,
  trackName: 'Placeholder Song',
  artistName: 'Placeholder Artist',
  duration: 200.4,
  instrumental: false,
  hasWordSync: true,
  hasPlainLyrics: true,
  hasSyncedLyrics: true
};
const record = { ...song, plainLyrics: 'Words', syncedLyrics: '[00:01.00]Words', lyricsfile: LYRICSFILE };
const candidate = {
  id: '7',
  title: 'Placeholder Song',
  artist: 'Placeholder Artist',
  durationMs: 200_400,
  has: { words: true, lines: true, plain: true },
  isInstrumental: false
};
/** Answers each URL from `answers` (the URL after `/api/`, by its start), and keeps the URLs asked for. */
function answering(answers: Record<string, unknown>) {
  const urls: string[] = [];
  const get = vi.fn<GetJson>(url => {
    const path = url.replace('https://lrclib.net/api/', '');
    urls.push(path);
    const key = Object.keys(answers).find(prefix => path.startsWith(prefix));
    const answer = key === undefined ? new HttpError('lrclib.net', 404) : answers[key];
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  });
  return { get, urls };
}

describe('server/lyrics-lrclib', () => {
  it('turns a Lyricsfile into LRC, with a time before each word of a word-timed line', () => {
    expect(lyricsfileToLrc(LYRICSFILE)).toBe(
      [
        '[01:01.000]<01:01.000>Placeholder <01:01.500>words <01:02.200>here<01:03.500>',
        "[01:05.000]<01:05.000>It's <01:05.400>again<01:06.000>",
        '[01:10.000]No words'
      ].join('\n')
    );
    expect(lyricsfileToLrc('lines:\n- start_ms: 1000\n  words:\n  - text: Open\n    start_ms: 1000\n  - text: x')).toBe(
      '[00:01.000]<00:01.000>Open'
    );
    expect(lyricsfileToLrc('')).toBe('');
    expect(lyricsfileToLrc('lines: [unclosed')).toBe('');
    expect(lyricsfileToLrc('just text')).toBe('');
  });

  it('searches by title and artist, naming itself, and tells which kinds of lyrics each song has', async () => {
    const { get, urls } = answering({
      'v2/search?': [song, { id: 8, trackName: 'Other', artistName: 'B', instrumental: true }]
    });
    await expect(lrclibSource().search(query, get)).resolves.toEqual([
      candidate,
      { id: '8', title: 'Other', artist: 'B', has: { words: false, lines: false, plain: false }, isInstrumental: true }
    ]);
    expect(urls).toEqual(['v2/search?track_name=Placeholder+Song&artist_name=Placeholder+Artist']);
    expect(get.mock.calls[0]?.[1]).toEqual({ 'User-Agent': expect.stringContaining('THE MAX MIX') as string });
  });

  it('reads every kind of lyrics of a song from one request for its record', async () => {
    const { get, urls } = answering({ 'get/7': record });
    const source = lrclibSource();
    await expect(source.words(candidate, get)).resolves.toBe(lyricsfileToLrc(LYRICSFILE));
    await expect(source.lines(candidate, get)).resolves.toBe('[00:01.00]Words');
    await expect(source.plain?.(candidate, get)).resolves.toBe('Words');
    expect(urls).toEqual(['get/7']);
    const empty = answering({ 'get/7': { id: 7 } });
    const other = lrclibSource();
    await expect(other.words(candidate, empty.get)).resolves.toBeNull();
    await expect(other.lines(candidate, empty.get)).resolves.toBeNull();
    await expect(other.plain?.(candidate, empty.get)).resolves.toBeNull();
  });

  it('asks for a record again after a failure, and keeps only the latest records', async () => {
    const source = lrclibSource();
    const failing = answering({ 'get/7': new Error('down') });
    await expect(source.lines(candidate, failing.get)).rejects.toThrow('down');
    const { get, urls } = answering({ 'get/': record });
    await expect(source.lines(candidate, get)).resolves.toBe('[00:01.00]Words');
    for (let id = 100; id < 120; id += 1) {
      // eslint-disable-next-line no-await-in-loop -- one after the other, as the order is what is tested.
      await source.lines({ ...candidate, id: String(id) }, get);
    }
    await source.lines(candidate, get);
    expect(urls.filter(url => url === 'get/7')).toHaveLength(2);
  });

  it('looks a song the search does not find up by title, artist and length', async () => {
    const { get, urls } = answering({ 'v2/search?': [], 'get?': record });
    const source = lrclibSource();
    await expect(source.search(query, get)).resolves.toEqual([candidate]);
    expect(urls[1]).toBe('get?track_name=Placeholder+Song&artist_name=Placeholder+Artist&duration=200');
    // That lookup came with the lyrics, so they are not asked for again.
    await expect(source.lines(candidate, get)).resolves.toBe('[00:01.00]Words');
    expect(urls).toHaveLength(2);

    const unknown = answering({ 'v2/search?': 'not a list' });
    await expect(lrclibSource().search({ title: 'T', artist: 'A' }, unknown.get)).resolves.toEqual([]);
    expect(unknown.urls[1]).toBe('get?track_name=T&artist_name=A');
    const busy = answering({ 'v2/search?': [], 'get?': new HttpError('lrclib.net', 503) });
    await expect(lrclibSource().search(query, busy.get)).resolves.toEqual([]);
    const broken = answering({ 'v2/search?': [], 'get?': new HttpError('lrclib.net', 500) });
    await expect(lrclibSource().search(query, broken.get)).rejects.toThrow('lrclib.net answered 500');
  });

  it('leaves LRCLIB alone for as long as it asks to be', async () => {
    const warn = vi.spyOn(console, 'warn').mockReturnValue();
    let time = 1000;
    const source = lrclibSource(() => time);
    const limited = answering({ 'v2/search?': new HttpError('lrclib.net', 429, 30_000) });
    await expect(source.search(query, limited.get)).rejects.toThrow('lrclib.net answered 429');
    const { get, urls } = answering({ 'v2/search?': [song] });
    time += 29_000;
    await expect(source.search(query, get)).rejects.toThrow('asked not to be called');
    expect(urls).toEqual([]);
    time += 1000;
    await expect(source.search(query, get)).resolves.toEqual([candidate]);
    expect(warn).toHaveBeenCalledExactlyOnceWith('lyrics: lrclib.net answered 429; not calling it for 30 s');
  });

  it('leaves LRCLIB alone for a minute after a 429 that does not say for how long', async () => {
    vi.spyOn(console, 'warn').mockReturnValue();
    let time = 0;
    const source = lrclibSource(() => time);
    const limited = answering({ 'v2/search?': new HttpError('lrclib.net', 429) });
    await expect(source.search(query, limited.get)).rejects.toBeInstanceOf(SourceResting);
    const { get, urls } = answering({ 'v2/search?': [song] });
    time += 59_000;
    await expect(source.search(query, get)).rejects.toBeInstanceOf(SourceResting);
    expect(urls).toEqual([]);
    time += 1000;
    await expect(source.search(query, get)).resolves.toEqual([candidate]);
  });

  it('sends one request at a time, so lookups that overlap get one 429 between them and log it once', async () => {
    const warn = vi.spyOn(console, 'warn').mockReturnValue();
    const source = lrclibSource(() => 0);
    let inFlight = 0;
    let most = 0;
    const urls: string[] = [];
    const get = vi.fn<GetJson>(async url => {
      urls.push(url);
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight -= 1;
      throw new HttpError('lrclib.net', 429);
    });
    const lookups = ['One', 'Two', 'Three', 'Four'].map(title => source.search({ ...query, title }, get));
    const results = await Promise.allSettled(lookups);
    expect(results.map(result => result.status)).toEqual(['rejected', 'rejected', 'rejected', 'rejected']);
    expect(urls).toHaveLength(1);
    expect(most).toBe(1);
    expect(warn).toHaveBeenCalledOnce();

    // While nothing fails, they still all get their turn.
    const ok = answering({ 'v2/search?': [song] });
    const fresh = lrclibSource();
    const found = await Promise.all([1, 2, 3].map(() => fresh.search(query, ok.get)));
    expect(found).toEqual([[candidate], [candidate], [candidate]]);
    expect(ok.urls).toHaveLength(3);
  });

  it('still takes a 503 with Retry-After as a song it does not have, but leaves LRCLIB alone after it', async () => {
    vi.spyOn(console, 'warn').mockReturnValue();
    const source = lrclibSource(() => 0);
    const busy = answering({ 'v2/search?': [], 'get?': new HttpError('lrclib.net', 503, 10_000) });
    await expect(source.search(query, busy.get)).resolves.toEqual([]);
    await expect(source.search(query, busy.get)).rejects.toBeInstanceOf(SourceResting);
    expect(busy.urls).toHaveLength(2);
  });
});
