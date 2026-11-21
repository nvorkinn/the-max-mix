// Musixmatch as a lyrics source of the kiosk service (lyrics.ts), through the API its desktop app uses, as syncedlyrics
// and onetagger do. That API needs no key, only a user token the API itself hands out (token.get), which is then sent
// with every call. It has line-timed lyrics ("subtitles") and, for many songs, word-timed ones ("richsync"), and its
// search says which a song has and whether it is instrumental.
import { count, HttpError, list, lrcTime, record, text } from './lyrics-sources.ts';
import type { Candidate, GetJson, LyricsSource } from './lyrics-sources.ts';

const API = 'https://apic-desktop.musixmatch.com/ws/1.1';
const APP_ID = 'web-desktop-app-v1.0';
const SEARCH_LIMIT = 8;
/** How long no new token is asked for after Musixmatch refused one, so a refusing API is not asked on every song. */
const TOKEN_BACKOFF_MS = 5 * 60 * 1000;
const STATUS_OK = 200;
const STATUS_UNAUTHORIZED = 401;
const STATUS_NOT_FOUND = 404;

/** One line of richsync as a line of LRC with timed words, or null when it has no times or words. */
const richsyncLine = (value: unknown): string | null => {
  const line = record(value);
  const start = line['ts'];
  const end = line['te'];
  if (typeof start !== 'number' || typeof end !== 'number') return null;
  let timed = '';
  const words = list(line['l']);
  for (const item of words) {
    const word = record(item);
    const characters = text(word['c']);
    const offset = word['o'];
    // Spaces come as words of their own; they stay with the word before them, so every timed word has text.
    if (typeof offset !== 'number' || characters.trim() === '') timed += characters;
    else timed += `<${lrcTime(Math.round((start + offset) * 1000))}>${characters}`;
  }
  return timed ? `[${lrcTime(Math.round(start * 1000))}]${timed.trimEnd()}<${lrcTime(Math.round(end * 1000))}>` : null;
};

/**
 * Musixmatch's word-timed lyrics as LRC with a `<mm:ss.xxx>` tag before each word and one where the line ends. A
 * richsync body is JSON: lines of `ts` (start) and `te` (end) in seconds and `l`, the words, each `c` (its text) and
 * `o` (its start from the line's). Empty when `json` is not that.
 */
export function richsyncToLrc(json: string): string {
  let lines: unknown;
  try {
    lines = JSON.parse(json);
  } catch {
    return '';
  }
  return list(lines)
    .map(line => richsyncLine(line))
    .filter(line => line !== null)
    .join('\n');
}

/** A song of a search's `track_list` as a candidate. */
function candidateOf(value: unknown): Candidate {
  const track = record(record(value)['track']);
  const seconds = count(track['track_length']);
  return {
    id: String(track['track_id']),
    title: text(track['track_name']),
    artist: text(track['artist_name']),
    ...(seconds !== undefined && { durationMs: seconds * 1000 }),
    has: { words: track['has_richsync'] === 1, lines: track['has_subtitles'] === 1, plain: false },
    isInstrumental: track['instrumental'] === 1
  };
}

/** A token that is only zeros is what Musixmatch hands out when it will not give a real one. */
const isRealToken = (token: string): boolean => /[^0]/.test(token);

/**
 * Musixmatch as a source. The token is asked for once and kept until Musixmatch stops taking it (a 401); when it
 * refuses to hand one out, the source fails at once for a while instead of asking again on every song. `now` is the
 * clock, for tests.
 */
export function musixmatchSource(now: () => number = () => Date.now()): LyricsSource {
  /** The token asked for, while it is being asked for and then for as long as it is taken. */
  let issued: Promise<string> | undefined;
  let refusedUntil = 0;

  const call = async (method: string, params: Record<string, string>, get: GetJson, usertoken = '') => {
    const query = new URLSearchParams({ ...params, app_id: APP_ID, t: String(now()) });
    if (usertoken) query.set('usertoken', usertoken);
    // Musixmatch answers most failures with HTTP 200 and the real status in the message's header.
    const message = record(record(await get(`${API}/${method}?${query}`))['message']);
    const status = record(message['header'])['status_code'];
    return { status: typeof status === 'number' ? status : 0, body: message['body'] };
  };

  const fetchToken = async (get: GetJson): Promise<string> => {
    const { status, body } = await call('token.get', { user_language: 'en' }, get);
    const handedOut = text(record(body)['user_token']);
    if (status !== STATUS_OK || !isRealToken(handedOut)) {
      refusedUntil = now() + TOKEN_BACKOFF_MS;
      throw new Error(`Musixmatch handed out no token (status ${status})`);
    }
    return handedOut;
  };

  const tokenFor = (get: GetJson): Promise<string> => {
    if (now() < refusedUntil) return Promise.reject(new Error('Musixmatch refused a token a short while ago'));
    if (issued) return issued;
    const fetching = fetchToken(get);
    issued = fetching;
    // A failed request for a token is not kept: the next song asks again (after the back-off, if it was refused).
    void fetching.catch(() => {
      if (issued === fetching) issued = undefined;
    });
    return fetching;
  };

  /** The body of an API call made with the token, or null when Musixmatch has nothing for it. */
  const ask = async (method: string, params: Record<string, string>, get: GetJson): Promise<unknown> => {
    const usertoken = await tokenFor(get);
    let answer: Awaited<ReturnType<typeof call>>;
    try {
      answer = await call(method, params, get, usertoken);
    } catch (error) {
      if (error instanceof HttpError && error.status === STATUS_UNAUTHORIZED) issued = undefined;
      throw error;
    }
    if (answer.status === STATUS_OK) return answer.body;
    if (answer.status === STATUS_NOT_FOUND) return null;
    if (answer.status === STATUS_UNAUTHORIZED) issued = undefined;
    throw new Error(`Musixmatch ${method} answered ${answer.status}`);
  };

  return {
    name: 'Musixmatch',
    async search(query, get) {
      const params = {
        q_track: query.title,
        q_artist: query.artist,
        page_size: String(SEARCH_LIMIT),
        page: '1',
        s_track_rating: 'desc'
      };
      return list(record(await ask('track.search', params, get))['track_list']).map(track => candidateOf(track));
    },
    async words(candidate, get) {
      const body = record(await ask('track.richsync.get', { track_id: candidate.id }, get));
      return richsyncToLrc(text(record(body['richsync'])['richsync_body'])) || null;
    },
    async lines(candidate, get) {
      const params = { track_id: candidate.id, subtitle_format: 'lrc' };
      const body = record(await ask('track.subtitle.get', params, get));
      return text(record(body['subtitle'])['subtitle_body']) || null;
    }
  };
}

export const musixmatch: LyricsSource = musixmatchSource();
