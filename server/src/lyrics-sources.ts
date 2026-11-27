// What a lyrics source is to the kiosk service (lyrics.ts), and three of them: NetEase Cloud Music, KuGou and QQ Music
// (LRCLIB is in lyrics-lrclib.ts). None of the three has a public API or allows requests from a web page, which is why
// the Pi's Node service asks them, not the app. Each is searched by title and artist, and gives back LRC text (time-stamped lines) for the song it found.
// Each also has lyrics that time every word, in a format of its own (NetEase: YRC, QQ Music: QRC, KuGou: KRC), which
// is asked for apart from the line-timed ones; those times come back as `<mm:ss.xxx>` tags inside the LRC's lines.
import { inflateSync } from 'node:zlib';
import { decryptQrc } from './qrc-cipher.ts';

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
  /** Which kinds of lyrics the song has, from a source whose search says; a kind it lacks is not asked for. */
  has?: { words: boolean; lines: boolean; plain: boolean };
  /** The source knows the song as one without lyrics. */
  isInstrumental?: boolean;
}

export interface LyricsSource {
  name: string;
  search: (query: LyricsQuery, get: GetJson) => Promise<Candidate[]>;
  /** The song's lyrics timed word by word, as LRC with a time before each word; null when the source has none. */
  words: (candidate: Candidate, get: GetJson) => Promise<string | null>;
  /** The song's line-timed LRC text, or null when the source has none for it. */
  lines: (candidate: Candidate, get: GetJson) => Promise<string | null>;
  /** The song's lyrics without times, a line of text per line, from a source that keeps those too. */
  plain?: (candidate: Candidate, get: GetJson) => Promise<string | null>;
}

const REQUEST_TIMEOUT_MS = 8000;
const SEARCH_LIMIT = 8;

/** A request a source answered with an error status. */
export class HttpError extends Error {
  readonly status: number;
  /** How long the source asked to be left alone (its Retry-After header), if it did. */
  readonly retryAfterMs: number | undefined;

  constructor(host: string, status: number, retryAfterMs?: number) {
    super(`${host} answered ${status}`);
    this.name = 'HttpError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * A source that is left alone for a while, after it asked to be (lyrics-lrclib.ts), failing a lookup without asking it.
 * The source logs once when that starts, so findLyrics (lyrics.ts) does not log each lookup this fails.
 */
export class SourceResting extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SourceResting';
  }
}

/** A Retry-After header (seconds, or an HTTP date) as milliseconds from `now`, or undefined when there is none. */
export function parseRetryAfter(header: string | null, now: number = Date.now()): number | undefined {
  if (!header?.trim()) return undefined;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  return ms > 0 ? ms : undefined;
}

export const getJson: GetJson = async (url, headers = {}) => {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) {
    const wait = parseRetryAfter(response.headers.get('Retry-After'));
    throw new HttpError(new URL(url).hostname, response.status, wait);
  }
  // Some of these services answer JSON as text/html or text/plain, so the body is parsed by hand.
  return JSON.parse(await response.text()) as unknown;
};

export const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
export const list = (value: unknown): unknown[] => (Array.isArray(value) ? (value as unknown[]) : []);
export const text = (value: unknown): string => (typeof value === 'string' ? value : '');
export const count = (value: unknown): number | undefined =>
  typeof value === 'number' && value > 0 ? value : undefined;
const withDuration = (candidate: Omit<Candidate, 'durationMs'>, durationMs: number | undefined): Candidate =>
  durationMs === undefined ? candidate : { ...candidate, durationMs };

const NETEASE_HEADERS = { Referer: 'https://music.163.com' };

/** A time in milliseconds as LRC writes it, `mm:ss.xxx`. */
export function lrcTime(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const seconds = (ms % 60_000) / 1000;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(3).padStart(6, '0')}`;
}

const TIMED_LINE = /^\[(\d+),(\d+)\](.*)$/;

/** A word of a word-timed line: when it starts and how long it lasts, in milliseconds. */
interface TimedWord {
  start: number;
  length: number;
  text: string;
}

/** The words of a line where each is `time` (its start and length) and then, up to the next time, its text. */
function wordsAfterTimes(rest: string, time: RegExp): TimedWord[] {
  // eslint-disable-next-line unicorn/prefer-iterator-to-array -- TypeScript's ES2024 lib has no Iterator#toArray yet.
  const times = [...rest.matchAll(time)];
  return times.map((found, index) => ({
    start: Number(found[1]),
    length: Number(found[2]),
    text: rest.slice(found.index + found[0].length, times[index + 1]?.index ?? rest.length)
  }));
}

/**
 * Word-timed lyrics whose lines are `[lineStart,lineLength]` and then timed words, as LRC with a `<mm:ss.xxx>` tag
 * before each word and one where the last word ends. `wordsOf` reads the words of a line (what follows its times);
 * `isFromLine` says their starts count from the line's. Lines without timed words are left out.
 */
function wordTimedLrc(lyrics: string, wordsOf: (rest: string) => TimedWord[], isFromLine = false): string {
  const lines: string[] = [];
  for (const raw of lyrics.split(/\r?\n/)) {
    const line = TIMED_LINE.exec(raw.trim());
    if (!line) continue;
    const lineStart = Number(line[1]);
    let timed = '';
    let end = 0;
    const words = wordsOf(line[3] ?? '');
    for (const word of words) {
      const start = word.start + (isFromLine ? lineStart : 0);
      timed += `<${lrcTime(start)}>${word.text}`;
      end = start + word.length;
    }
    if (timed) lines.push(`[${lrcTime(lineStart)}]${timed}<${lrcTime(end)}>`);
  }
  return lines.join('\n');
}

/**
 * NetEase's word-timed lyrics as LRC. YRC is `[lineStart,lineLength](wordStart,wordLength,0)word…`; the JSON credit
 * lines NetEase puts first are left out.
 */
export function yrcToLrc(yrc: string): string {
  return wordTimedLrc(yrc, rest => wordsAfterTimes(rest, /\((\d+),(\d+),\d+\)/g));
}

const KRC_MAGIC = 'krc1';
const KRC_KEY = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];

/**
 * KuGou's word-timed lyrics as LRC, from the base64 it downloads as: "krc1", then zlib data XORed with a fixed key.
 * KRC is `[lineStart,lineLength]<wordStart,wordLength,0>word…`, a word's start counted from its line's. Empty when
 * `content` is not KRC.
 */
export function krcToLrc(content: string): string {
  const data = Buffer.from(content, 'base64');
  if (data.subarray(0, KRC_MAGIC.length).toString('latin1') !== KRC_MAGIC) return '';
  const zipped = data.subarray(KRC_MAGIC.length).map((byte, index) => byte ^ (KRC_KEY[index % KRC_KEY.length] ?? 0));
  const krc = inflateSync(zipped).toString('utf8');
  return wordTimedLrc(krc, rest => wordsAfterTimes(rest, /<(\d+),(\d+),\d+>/g), true);
}

const XML_ENTITIES: Record<string, string> = { amp: '&', apos: "'", gt: '>', lt: '<', quot: '"' };
const QRC_TIME = /\((\d+),(\d+)\)/g;

/** The words of a QRC line, where each word's time comes after its text. */
function qrcWords(rest: string): TimedWord[] {
  const words: TimedWord[] = [];
  let from = 0;
  for (const time of rest.matchAll(QRC_TIME)) {
    words.push({ start: Number(time[1]), length: Number(time[2]), text: rest.slice(from, time.index) });
    from = time.index + time[0].length;
  }
  return words;
}

/**
 * QQ Music's word-timed lyrics as LRC. QRC is XML with the lyrics in a `LyricContent` attribute, as
 * `[lineStart,lineLength]word(wordStart,wordLength)…`. Empty when `xml` is not QRC (QQ answers with plain LRC for a
 * song it has no word times for).
 */
export function qrcToLrc(xml: string): string {
  const content = /LyricContent="([^"]*)"/.exec(xml)?.[1] ?? '';
  const lyrics = content.replaceAll(/&(amp|apos|gt|lt|quot);/g, (entity, name: string) => XML_ENTITIES[name] ?? entity);
  return wordTimedLrc(lyrics, qrcWords);
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
  async words(candidate, get) {
    const body = record(await get(`https://music.163.com/api/song/lyric/v1?id=${candidate.id}&yv=1`, NETEASE_HEADERS));
    return yrcToLrc(text(record(body['yrc'])['lyric'])) || null;
  },
  async lines(candidate, get) {
    const body = record(await get(`https://music.163.com/api/song/lyric/v1?id=${candidate.id}&lv=1`, NETEASE_HEADERS));
    return text(record(body['lrc'])['lyric']) || null;
  }
};

/**
 * KuGou keeps lyrics apart from songs: finds the lyrics for the song's hash, then downloads the best one in `format`.
 * The download's base64 content, or null when the song has no lyrics.
 */
async function kugouDownload(candidate: Candidate, format: 'krc' | 'lrc', get: GetJson): Promise<string | null> {
  const found = record(await get(`https://lyrics.kugou.com/search?ver=1&man=yes&client=pc&hash=${candidate.id}`));
  const best = record(list(found['candidates'])[0]);
  const id = text(best['id']);
  const key = text(best['accesskey']);
  if (!id || !key) return null;
  const params = new URLSearchParams({ ver: '1', client: 'pc', id, accesskey: key, fmt: format, charset: 'utf8' });
  return text(record(await get(`https://lyrics.kugou.com/download?${params}`))['content']) || null;
}

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
  async words(candidate, get) {
    const content = await kugouDownload(candidate, 'krc', get);
    return (content && krcToLrc(content)) || null;
  },
  async lines(candidate, get) {
    const content = await kugouDownload(candidate, 'lrc', get);
    return content ? Buffer.from(content, 'base64').toString('utf8') : null;
  }
};

const QQ_HEADERS = { Referer: 'https://y.qq.com/' };

/** Calls a method of QQ Music's desktop API, which takes its request as JSON in the URL; the method's answer. */
async function qqCall(module: string, method: string, param: Record<string, unknown>, get: GetJson): Promise<unknown> {
  const data = JSON.stringify({ comm: { ct: '19', cv: '1859', uin: '0' }, req: { module, method, param } });
  const body = record(await get(`https://u.y.qq.com/cgi-bin/musicu.fcg?${new URLSearchParams({ data })}`, QQ_HEADERS));
  return record(body['req'])['data'];
}

export const qqMusic: LyricsSource = {
  name: 'QQ Music',
  async search(query, get) {
    // grp is needed: without it the search answers with nothing.
    const param = {
      grp: 1,
      num_per_page: SEARCH_LIMIT,
      page_num: 1,
      query: `${query.title} ${query.artist}`,
      search_type: 0
    };
    const data = record(await qqCall('music.search.SearchCgiService', 'DoSearchForQQMusicDesktop', param, get));
    return list(record(record(data['body'])['song'])['list']).map(item => {
      const song = record(item);
      const seconds = count(song['interval']);
      return withDuration(
        {
          id: text(song['mid']),
          title: text(song['name']),
          artist: list(song['singer'])
            .map(singer => text(record(singer)['name']))
            .join(' ')
        },
        seconds && seconds * 1000
      );
    });
  },
  async words(candidate, get) {
    // qrc asks for the word-timed lyrics, which QQ only sends encrypted (crypt).
    const param = { songMID: candidate.id, qrc: 1, crypt: 1 };
    const data = record(await qqCall('music.musichallSong.PlayLyricInfo', 'GetPlayLyricInfo', param, get));
    const encrypted = text(data['lyric']);
    return (encrypted && qrcToLrc(decryptQrc(encrypted))) || null;
  },
  async lines(candidate, get) {
    const params = new URLSearchParams({ songmid: candidate.id, format: 'json', nobase64: '1' });
    const body = record(await get(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${params}`, QQ_HEADERS));
    return text(body['lyric']) || null;
  }
};
