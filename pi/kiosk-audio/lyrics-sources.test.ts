import { describe, expect, it, vi } from 'vitest';
import { getJson, kugou, netease, qqMusic, yrcToLrc } from './lyrics-sources.ts';
import type { GetJson } from './lyrics-sources.ts';

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

describe('kiosk-audio/lyrics-sources', () => {
  it('NetEase: searches, then reads the lyrics of a song', async () => {
    const get = answering({
      'https://music.163.com/api/search/get?': {
        result: {
          songs: [{ id: 7, name: 'Placeholder Song', duration: 200_000, artists: [{ name: 'A' }, { name: 'B' }] }]
        }
      },
      'https://music.163.com/api/song/lyric/v1?id=7&lv=1&yv=1': { lrc: { lyric: '[00:01.00]Words' } }
    });
    const found = await netease.search(query, get);
    expect(found).toEqual([{ id: '7', title: 'Placeholder Song', artist: 'A B', durationMs: 200_000 }]);
    await expect(netease.lyrics(only(found), get)).resolves.toBe('[00:01.00]Words');
    await expect(
      netease.lyrics(only(found), answering({ 'https://music.163.com/api/song/lyric': { lrc: { lyric: '' } } }))
    ).resolves.toBeNull();
    await expect(netease.search(query, answering({ 'https://music.163.com/api/search/get?': {} }))).resolves.toEqual(
      []
    );
  });

  it('NetEase: prefers the word-timed lyrics, as LRC with a time before each word', async () => {
    const yrc = [
      '{"t":0,"c":[{"tx":"Placeholder credits"}]}',
      '[61000,2500](61000,500,0)Placeholder (61500,700,0)words (62200,1300,0)here',
      '[65000,1000](65000,1000,0)Again'
    ].join('\n');
    const get = answering({
      'https://music.163.com/api/song/lyric': {
        lrc: { lyric: '[01:01.00]Placeholder words here' },
        yrc: { lyric: yrc }
      }
    });
    const lrc =
      '[01:01.000]<01:01.000>Placeholder <01:01.500>words <01:02.200>here<01:03.500>\n[01:05.000]<01:05.000>Again<01:06.000>';
    await expect(netease.lyrics({ id: '7', title: 'Placeholder Song', artist: 'A' }, get)).resolves.toBe(lrc);
    expect(yrcToLrc('')).toBe('');
    expect(yrcToLrc('[1000,500]no words')).toBe('');
  });

  it('QQ Music: searches, then reads the lyrics of a song', async () => {
    const get = answering({
      'https://c.y.qq.com/soso/': {
        data: {
          song: { list: [{ songmid: 'abc', songname: 'Placeholder Song', interval: 200, singer: [{ name: 'A' }] }] }
        }
      },
      'https://c.y.qq.com/lyric/': { lyric: '[00:01.00]Words' }
    });
    const found = await qqMusic.search(query, get);
    expect(found).toEqual([{ id: 'abc', title: 'Placeholder Song', artist: 'A', durationMs: 200_000 }]);
    await expect(qqMusic.lyrics(only(found), get)).resolves.toBe('[00:01.00]Words');
    await expect(qqMusic.lyrics(only(found), answering({ 'https://c.y.qq.com/lyric/': {} }))).resolves.toBeNull();
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
    await expect(kugou.lyrics(only(found), get)).resolves.toBe('[00:01.00]Words');
    await expect(
      kugou.lyrics(only(found), answering({ 'https://lyrics.kugou.com/search?': { candidates: [] } }))
    ).resolves.toBeNull();
    const empty = answering({
      'https://lyrics.kugou.com/search?': { candidates: [{ id: '9', accesskey: 'k' }] },
      'https://lyrics.kugou.com/download?': {}
    });
    await expect(kugou.lyrics(only(found), empty)).resolves.toBeNull();
  });

  it('getJson parses the answer whatever its content type, and rejects a failed request', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"a":1}', { headers: { 'Content-Type': 'text/html' } }))
      .mockResolvedValueOnce(new Response('no', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getJson('https://example.com/x', { Referer: 'r' })).resolves.toEqual({ a: 1 });
    await expect(getJson('https://example.com/x')).rejects.toThrow('example.com answered 500');
    vi.unstubAllGlobals();
  });
});
