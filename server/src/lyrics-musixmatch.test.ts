import { describe, expect, it, vi } from 'vitest';
import { musixmatchSource, richsyncToLrc } from './lyrics-musixmatch.ts';
import type { GetJson } from './lyrics-sources.ts';

const query = { title: 'Placeholder Song', artist: 'Placeholder Artist' };
const API = 'https://apic-desktop.musixmatch.com/ws/1.1/';
const TOKEN = 'abc123';
const ZERO_TOKEN = '0'.repeat(56);

const message = (body: unknown, status = 200) => ({ message: { header: { status_code: status }, body } });
const tokenAnswer = (token: string) => message({ user_token: token });
const track = {
  track_id: 7,
  track_name: 'Placeholder Song',
  artist_name: 'Placeholder Artist',
  track_length: 200,
  has_subtitles: 1,
  has_richsync: 1,
  instrumental: 0
};
const candidate = { id: '7', title: 'Placeholder Song', artist: 'Placeholder Artist' };

/** Answers each Musixmatch method with what `answers` gives for it, and records the URLs asked. */
function musixmatch(answers: Record<string, () => unknown>) {
  const urls: URL[] = [];
  const get = vi.fn<GetJson>(raw => {
    const url = new URL(raw);
    urls.push(url);
    const answer = answers[url.pathname.slice(new URL(API).pathname.length)];
    return answer ? Promise.resolve(answer()) : Promise.reject(new Error(`unexpected ${raw}`));
  });
  return { get, urls };
}

const RICHSYNC = JSON.stringify([
  {
    ts: 61,
    te: 63.5,
    l: [
      { c: 'Placeholder', o: 0 },
      { c: ' ', o: 0.4 },
      { c: 'words', o: 0.5 },
      { c: ' ', o: 1 },
      { c: 'here', o: 1.2 }
    ],
    x: 'Placeholder words here'
  },
  { ts: 65, te: 66, l: [], x: '' },
  { ts: 'later', te: 70, l: [{ c: 'Untimed', o: 0 }] }
]);

describe('server/lyrics-musixmatch', () => {
  it('turns richsync into LRC with a time before each word and one where the line ends', () => {
    expect(richsyncToLrc(RICHSYNC)).toBe(
      '[01:01.000]<01:01.000>Placeholder <01:01.500>words <01:02.200>here<01:03.500>'
    );
    expect(richsyncToLrc('not json')).toBe('');
  });

  it('asks for a token once, then searches and reads both kinds of lyrics with it', async () => {
    const { get, urls } = musixmatch({
      'token.get': () => tokenAnswer(TOKEN),
      'track.search': () => message({ track_list: [{ track }] }),
      'track.richsync.get': () => message({ richsync: { richsync_body: RICHSYNC } }),
      'track.subtitle.get': () => message({ subtitle: { subtitle_body: '[00:01.00] Words' } })
    });
    const source = musixmatchSource(() => 1000);
    await expect(source.search(query, get)).resolves.toEqual([
      {
        ...candidate,
        durationMs: 200_000,
        has: { words: true, lines: true, plain: false },
        isInstrumental: false
      }
    ]);
    await expect(source.words(candidate, get)).resolves.toMatch(/^\[01:01\.000\]<01:01\.000>Placeholder /);
    await expect(source.lines(candidate, get)).resolves.toBe('[00:01.00] Words');
    expect(urls.filter(url => url.pathname.endsWith('token.get'))).toHaveLength(1);
    const search = urls.find(url => url.pathname.endsWith('track.search'));
    expect(search?.searchParams.get('usertoken')).toBe(TOKEN);
    expect(search?.searchParams.get('app_id')).toBe('web-desktop-app-v1.0');
    expect(search?.searchParams.get('q_track')).toBe('Placeholder Song');
    expect(search?.searchParams.get('q_artist')).toBe('Placeholder Artist');
  });

  it('answers null for a song Musixmatch has no lyrics for', async () => {
    const { get } = musixmatch({
      'token.get': () => tokenAnswer(TOKEN),
      'track.richsync.get': () => message(undefined, 404),
      'track.subtitle.get': () => message([], 404)
    });
    const source = musixmatchSource();
    await expect(source.words(candidate, get)).resolves.toBeNull();
    await expect(source.lines(candidate, get)).resolves.toBeNull();
  });

  it('asks for a new token after Musixmatch stops taking the one it has', async () => {
    const tokens = ['first', 'second'];
    const searches: number[] = [200];
    const { get, urls } = musixmatch({
      'token.get': () => tokenAnswer(tokens.shift() ?? ''),
      'track.search': () => message({ track_list: [] }, searches.shift() ?? 401)
    });
    const source = musixmatchSource();
    await expect(source.search(query, get)).resolves.toEqual([]);
    await expect(source.search(query, get)).rejects.toThrow('track.search answered 401');
    searches.push(200);
    await expect(source.search(query, get)).resolves.toEqual([]);
    const used = urls
      .filter(url => url.pathname.endsWith('track.search'))
      .map(url => url.searchParams.get('usertoken'));
    expect(used).toEqual(['first', 'first', 'second']);
  });

  it('fails without asking again for a while after Musixmatch hands out a token of only zeros', async () => {
    let time = 0;
    const { get, urls } = musixmatch({ 'token.get': () => tokenAnswer(ZERO_TOKEN) });
    const source = musixmatchSource(() => time);
    await expect(source.search(query, get)).rejects.toThrow('no token');
    time = 60_000;
    await expect(source.search(query, get)).rejects.toThrow('a short while ago');
    expect(urls).toHaveLength(1);
    time = 6 * 60_000;
    await expect(source.search(query, get)).rejects.toThrow('no token');
    expect(urls).toHaveLength(2);
  });
});
