import { deflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { getJson, krcToLrc, kugou, netease, qqMusic, qrcToLrc, yrcToLrc } from './lyrics-sources.ts';
import type { GetJson } from './lyrics-sources.ts';
import { decryptQrc } from './qrc-cipher.ts';

const query = { title: 'Placeholder Song', artist: 'Placeholder Artist' };
const only = <T>(items: readonly T[]): T => {
  const [item] = items;
  if (item === undefined) throw new Error('Expected a result');
  return item;
};
const answering =
  (answers: Record<string, unknown>): GetJson =>
  url => {
    const key = Object.keys(answers).find(prefix => url.startsWith(prefix));
    return key ? Promise.resolve(answers[key]) : Promise.reject(new Error(`unexpected ${url}`));
  };

const WORD_TIMED_LRC =
  "[01:01.000]<01:01.000>Placeholder <01:01.500>(words) <01:02.200>here<01:03.500>\n[01:05.000]<01:05.000>It's <01:05.400>again<01:06.000>";

/** `text` as KuGou downloads its word-timed lyrics. */
function krc(text: string): string {
  const key = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];
  const zipped = deflateSync(Buffer.from(text, 'utf8')).map((byte, index) => byte ^ (key[index % key.length] ?? 0));
  return Buffer.concat([Buffer.from('krc1'), zipped]).toString('base64');
}

// QQ Music's encryption of a QRC document with the lines of WORD_TIMED_LRC (its `'` as `&apos;`).
const ENCRYPTED_QRC =
  '79C58F03C702E01A5A2461A58F765246C8BB489CF259D2C08D4E59E3EA84E98F0BEA8F6DE1E48D2C60FB96EF3A49229AB9310DD2B67CA5B4' +
  '5505F1A1EEB969585D8CB9574D9B09A676F5841B20A91873D2FDDCD753092FDC0892FFA47A5AFE294605AC5051C722F9F5215CB88F4A72CF' +
  '787A362F40538336A70B9F31E7FB5801BDC30057ACF7928454A1F8B17EA076A268F72547EF240D03B2B756204907C80C095DEBD0AF8BE320' +
  'B3D5DFFA6771D01C92959A8E87B843EEF98125F181E767F85866913E77B6C0EF1ACBD15E48987F803A1675911ACE6D92082BCDBB6E1ABEA4' +
  '64E93205A1FB2E2137D1B9115CB77EB5';

describe('kiosk-audio/lyrics-sources', () => {
  it('NetEase: searches, then reads the lyrics of a song', async () => {
    const get = answering({
      'https://music.163.com/api/search/get?': {
        result: {
          songs: [{ id: 7, name: 'Placeholder Song', duration: 200_000, artists: [{ name: 'A' }, { name: 'B' }] }]
        }
      },
      'https://music.163.com/api/song/lyric/v1?id=7&lv=1': { lrc: { lyric: '[00:01.00]Words' } }
    });
    const found = await netease.search(query, get);
    expect(found).toEqual([{ id: '7', title: 'Placeholder Song', artist: 'A B', durationMs: 200_000 }]);
    await expect(netease.lines(only(found), get)).resolves.toBe('[00:01.00]Words');
    await expect(
      netease.lines(only(found), answering({ 'https://music.163.com/api/song/lyric': { lrc: { lyric: '' } } }))
    ).resolves.toBeNull();
    await expect(netease.search(query, answering({ 'https://music.163.com/api/search/get?': {} }))).resolves.toEqual(
      []
    );
  });

  it('NetEase: reads the word-timed lyrics, as LRC with a time before each word', async () => {
    const yrc = [
      '{"t":0,"c":[{"tx":"Placeholder credits"}]}',
      '[61000,2500](61000,500,0)Placeholder (61500,700,0)words (62200,1300,0)here',
      '[65000,1000](65000,1000,0)Again'
    ].join('\n');
    const get = answering({ 'https://music.163.com/api/song/lyric/v1?id=7&yv=1': { yrc: { lyric: yrc } } });
    const lrc =
      '[01:01.000]<01:01.000>Placeholder <01:01.500>words <01:02.200>here<01:03.500>\n[01:05.000]<01:05.000>Again<01:06.000>';
    const song = { id: '7', title: 'Placeholder Song', artist: 'A' };
    await expect(netease.words(song, get)).resolves.toBe(lrc);
    await expect(netease.words(song, answering({ 'https://music.163.com/api/song/lyric': {} }))).resolves.toBeNull();
    expect(yrcToLrc('')).toBe('');
    expect(yrcToLrc('[1000,500]no words')).toBe('');
  });

  it('QQ Music: searches, then reads the lyrics of a song', async () => {
    const get = answering({
      'https://u.y.qq.com/cgi-bin/musicu.fcg?': {
        req: {
          data: {
            body: {
              song: { list: [{ mid: 'abc', name: 'Placeholder Song', interval: 200, singer: [{ name: 'A' }] }] }
            }
          }
        }
      },
      'https://c.y.qq.com/lyric/': { lyric: '[00:01.00]Words' }
    });
    const found = await qqMusic.search(query, get);
    expect(found).toEqual([{ id: 'abc', title: 'Placeholder Song', artist: 'A', durationMs: 200_000 }]);
    await expect(qqMusic.lines(only(found), get)).resolves.toBe('[00:01.00]Words');
    await expect(qqMusic.lines(only(found), answering({ 'https://c.y.qq.com/lyric/': {} }))).resolves.toBeNull();
  });

  it('QQ Music: asks its desktop API for a search and for the word-timed lyrics', async () => {
    const asked: unknown[] = [];
    const get: GetJson = url => {
      asked.push(JSON.parse(new URL(url).searchParams.get('data') ?? ''));
      return Promise.resolve({ req: { data: { lyric: ENCRYPTED_QRC } } });
    };
    await qqMusic.search(query, get);
    await qqMusic.words({ id: 'abc', title: 'Placeholder Song', artist: 'A' }, get);
    expect(asked).toMatchObject([
      {
        req: {
          module: 'music.search.SearchCgiService',
          method: 'DoSearchForQQMusicDesktop',
          param: { grp: 1, query: 'Placeholder Song Placeholder Artist' }
        }
      },
      {
        req: {
          module: 'music.musichallSong.PlayLyricInfo',
          method: 'GetPlayLyricInfo',
          param: { songMID: 'abc', qrc: 1, crypt: 1 }
        }
      }
    ]);
  });

  it('QQ Music: decrypts the word-timed lyrics, as LRC with a time before each word', async () => {
    const song = { id: 'abc', title: 'Placeholder Song', artist: 'A' };
    const answer = (lyric: string) => answering({ 'https://u.y.qq.com/': { req: { data: { lyric } } } });
    await expect(qqMusic.words(song, answer(ENCRYPTED_QRC))).resolves.toBe(WORD_TIMED_LRC);
    await expect(qqMusic.words(song, answer(''))).resolves.toBeNull();
    await expect(qqMusic.words(song, answering({ 'https://u.y.qq.com/': {} }))).resolves.toBeNull();
    expect(decryptQrc(ENCRYPTED_QRC)).toContain('<Lyric_1 LyricType="1" LyricContent="[ti:Placeholder Song]');
    expect(() => decryptQrc('79C58F')).toThrow('cannot be decrypted');
    expect(() => decryptQrc('not hex')).toThrow('cannot be decrypted');
    // A song QQ has no word times for comes as plain LRC, not as QRC.
    expect(qrcToLrc('[00:01.00]Words')).toBe('');
  });

  it('KuGou: searches by song, then finds and downloads its lyrics', async () => {
    const content = Buffer.from('[00:01.00]Words').toString('base64');
    const get = answering({
      // eslint-disable-next-line sonarjs/no-clear-text-protocols, unicorn/prefer-https -- the search host only works over plain http
      'http://mobilecdn.kugou.com/': {
        data: {
          info: [
            { hash: 'h1', songname: 'Placeholder Song', singername: 'A', duration: 200 },
            { hash: 'h2', songname: 'No Length', singername: 'A' }
          ]
        }
      },
      'https://lyrics.kugou.com/search?': { candidates: [{ id: '9', accesskey: 'key' }] },
      'https://lyrics.kugou.com/download?': { content }
    });
    const found = await kugou.search(query, get);
    expect(found).toEqual([
      { id: 'h1', title: 'Placeholder Song', artist: 'A', durationMs: 200_000 },
      { id: 'h2', title: 'No Length', artist: 'A' }
    ]);
    await expect(kugou.lines(only(found), get)).resolves.toBe('[00:01.00]Words');
    await expect(
      kugou.lines(only(found), answering({ 'https://lyrics.kugou.com/search?': { candidates: [] } }))
    ).resolves.toBeNull();
    const empty = answering({
      'https://lyrics.kugou.com/search?': { candidates: [{ id: '9', accesskey: 'k' }] },
      'https://lyrics.kugou.com/download?': {}
    });
    await expect(kugou.lines(only(found), empty)).resolves.toBeNull();
    await expect(kugou.words(only(found), empty)).resolves.toBeNull();
  });

  it('KuGou: unpacks the word-timed lyrics, as LRC with a time before each word', async () => {
    const content = krc(
      [
        '[ti:Placeholder Song]',
        '[61000,2500]<0,500,0>Placeholder <500,700,0>(words) <1200,1300,0>here',
        "[65000,1000]<0,400,0>It's <400,600,0>again"
      ].join('\r\n')
    );
    const urls: string[] = [];
    const get: GetJson = url => {
      urls.push(url);
      return Promise.resolve(url.includes('/search?') ? { candidates: [{ id: '9', accesskey: 'key' }] } : { content });
    };
    const song = { id: 'h1', title: 'Placeholder Song', artist: 'A' };
    await expect(kugou.words(song, get)).resolves.toBe(WORD_TIMED_LRC);
    expect(urls[1]).toContain('fmt=krc');
    await kugou.lines(song, get);
    expect(urls[3]).toContain('fmt=lrc');
    // Lyrics KuGou only has line by line come as LRC whatever format is asked for.
    expect(krcToLrc(Buffer.from('[00:01.00]Words').toString('base64'))).toBe('');
  });

  it('getJson parses the answer whatever its content type, and rejects a failed request', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"a":1}', { headers: { 'Content-Type': 'text/html' } }))
      .mockResolvedValueOnce(new Response('no', { status: 500 }))
      .mockResolvedValueOnce(new Response('slow down', { status: 429, headers: { 'Retry-After': '30' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getJson('https://example.com/x', { Referer: 'r' })).resolves.toEqual({ a: 1 });
    await expect(getJson('https://example.com/x')).rejects.toThrow('example.com answered 500');
    // The status and how long the source asked to be left alone come with the failure.
    await expect(getJson('https://example.com/x')).rejects.toMatchObject({
      name: 'HttpError',
      status: 429,
      retryAfterMs: 30_000
    });
    vi.unstubAllGlobals();
  });
});
