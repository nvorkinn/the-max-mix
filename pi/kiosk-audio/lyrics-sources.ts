// The synced-lyrics sources the kiosk service asks for the app (lyrics.ts): NetEase Cloud Music, KuGou and QQ Music.
// None of them has a public API or allows requests from a web page, which is why the Pi's Node service asks them, not
// the app. Each is searched by title and artist, and gives back LRC text (time-stamped lines) for the song it found.
// Where a source also times each word (NetEase), the LRC carries those times as `<mm:ss.xxx>` tags inside the line.

/** Gets a URL and parses the JSON answer; rejects on a failed request. */
export type GetJson = (url: string, headers?: Record<string, string>) => Promise<unknown>;

/** What a source needs to find a song. */
export interface LyricsQuery {
  title: string;
  artist: string;
  durationMs?: number;
}

/** A song a source's search found. `id` is whatever that source needs to fetch the lyrics. */
export interface Candidate {
  id: string;
  title: string;
  artist: string;
  durationMs?: number;
}

export interface LyricsSource {
  name: string;
  search: (query: LyricsQuery, get: GetJson) => Promise<Candidate[]>;
  /** The song's LRC text, or null when the source has none for it. */
  lyrics: (candidate: Candidate, get: GetJson) => Promise<string | null>;
}

const REQUEST_TIMEOUT_MS = 8000;
const SEARCH_LIMIT = 8;

export const getJson: GetJson = async (url, headers = {}) => {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${new URL(url).hostname} answered ${response.status}`);
  // Some of these services answer JSON as text/html or text/plain, so the body is parsed by hand.
  return JSON.parse(await response.text()) as unknown;
};

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? (value as unknown[]) : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const count = (value: unknown): number | undefined => (typeof value === 'number' && value > 0 ? value : undefined);
const withDuration = (candidate: Omit<Candidate, 'durationMs'>, durationMs: number | undefined): Candidate =>
  durationMs === undefined ? candidate : { ...candidate, durationMs };

const NETEASE_HEADERS = { Referer: 'https://music.163.com' };

/** A time in milliseconds as LRC writes it, `mm:ss.xxx`. */
function lrcTime(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const seconds = (ms % 60_000) / 1000;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(3).padStart(6, '0')}`;
}

const YRC_LINE = /^\[(\d+),(\d+)\](.*)$/;
const YRC_WORD = /\((\d+),(\d+),\d+\)([^(]*)/g;

/**
 * NetEase's word-timed lyrics ("yrc": `[lineStart,lineLength](wordStart,wordLength,0)word…`, in milliseconds) as LRC
 * with a `<mm:ss.xxx>` tag before each word and one where the last word ends. Lines without words (the JSON credit
 * lines NetEase puts first) are left out.
 */
export function yrcToLrc(yrc: string): string {
  const lines: string[] = [];
  for (const raw of yrc.split(/\r?\n/)) {
    const line = YRC_LINE.exec(raw.trim());
    if (!line) continue;
    let timed = '';
    let end = 0;
    const words = (line[3] ?? '').matchAll(YRC_WORD);
    for (const word of words) {
      const start = Number(word[1]);
      timed += `<${lrcTime(start)}>${word[3] ?? ''}`;
      end = start + Number(word[2]);
    }
    if (timed) lines.push(`[${lrcTime(Number(line[1]))}]${timed}<${lrcTime(end)}>`);
  }
  return lines.join('\n');
}

export const netease: LyricsSource = {
  name: 'NetEase',
  async search(query, get) {
    const params = new URLSearchParams({ s: `${query.title} ${query.artist}`, type: '1', limit: String(SEARCH_LIMIT) });
    const body = record(await get(`https://music.163.com/api/search/get?${params}`, NETEASE_HEADERS));
    return list(record(body['result'])['songs']).map(item => {
      const song = record(item);
      return withDuration(
        {
          id: String(song['id']),
          title: text(song['name']),
          artist: list(song['artists'])
            .map(artist => text(record(artist)['name']))
            .join(' ')
        },
        count(song['duration'])
      );
    });
  },
  async lyrics(candidate, get) {
    // yv=1 asks for the word-timed lyrics too; most songs only have the line-timed ones.
    const body = record(
      await get(`https://music.163.com/api/song/lyric/v1?id=${candidate.id}&lv=1&yv=1`, NETEASE_HEADERS)
    );
    return yrcToLrc(text(record(body['yrc'])['lyric'])) || text(record(body['lrc'])['lyric']) || null;
  }
};

export const kugou: LyricsSource = {
  name: 'KuGou',
  async search(query, get) {
    const params = new URLSearchParams({
      keyword: `${query.title} ${query.artist}`,
      pagesize: String(SEARCH_LIMIT),
      format: 'json'
    });
    // Plain http on purpose: this host presents a certificate for another domain, so https fails.
    // eslint-disable-next-line unicorn/prefer-https
    const body = record(await get(`http://mobilecdn.kugou.com/api/v3/search/song?${params}`));
    return list(record(body['data'])['info']).map(item => {
      const song = record(item);
      const seconds = count(song['duration']);
      return withDuration(
        { id: text(song['hash']), title: text(song['songname']), artist: text(song['singername']) },
        seconds && seconds * 1000
      );
    });
  },
  async lyrics(candidate, get) {
    // KuGou keeps lyrics apart from songs: find the lyrics for the song's hash, then download the best one.
    const found = record(await get(`https://lyrics.kugou.com/search?ver=1&man=yes&client=pc&hash=${candidate.id}`));
    const best = record(list(found['candidates'])[0]);
    const id = text(best['id']);
    const key = text(best['accesskey']);
    if (!id || !key) return null;
    const params = new URLSearchParams({ ver: '1', client: 'pc', id, accesskey: key, fmt: 'lrc', charset: 'utf8' });
    const download = record(await get(`https://lyrics.kugou.com/download?${params}`));
    const content = text(download['content']);
    return content ? Buffer.from(content, 'base64').toString('utf8') : null;
  }
};

const QQ_HEADERS = { Referer: 'https://y.qq.com/' };

export const qqMusic: LyricsSource = {
  name: 'QQ Music',
  async search(query, get) {
    const params = new URLSearchParams({
      w: `${query.title} ${query.artist}`,
      format: 'json',
      n: String(SEARCH_LIMIT),
      p: '1'
    });
    const body = record(await get(`https://c.y.qq.com/soso/fcgi-bin/client_search_cp?${params}`, QQ_HEADERS));
    return list(record(record(body['data'])['song'])['list']).map(item => {
      const song = record(item);
      const seconds = count(song['interval']);
      return withDuration(
        {
          id: text(song['songmid']),
          title: text(song['songname']),
          artist: list(song['singer'])
            .map(singer => text(record(singer)['name']))
            .join(' ')
        },
        seconds && seconds * 1000
      );
    });
  },
  async lyrics(candidate, get) {
    const params = new URLSearchParams({ songmid: candidate.id, format: 'json', nobase64: '1' });
    const body = record(await get(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${params}`, QQ_HEADERS));
    return text(body['lyric']) || null;
  }
};

/** The sources, in the order they are asked. */
export const SOURCES: readonly LyricsSource[] = [netease, qqMusic, kugou];
