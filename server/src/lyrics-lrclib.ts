// LRCLIB (https://lrclib.net) as a lyrics source of the kiosk service (lyrics.ts): a free, open lyrics database with a
// documented API (https://lrclib.net/docs) that needs no key. Besides line-timed lyrics it has plain ones, knows which
// songs are instrumental, and has word-timed lyrics for the songs whose record says `hasWordSync`.
import { parse } from 'yaml';
import { count, HttpError, list, lrcTime, record, SourceResting, text } from './lyrics-sources.ts';
import type { Candidate, GetJson, LyricsSource } from './lyrics-sources.ts';

const API = 'https://lrclib.net/api';
// LRCLIB asks clients to name themselves, and allows a named one more requests.
const HEADERS = { 'User-Agent': 'THE MAX MIX (https://github.com/nvorkinn/the-max-mix)' };
/** How many songs' records are kept, so the kinds of lyrics of one song take one request. */
const RECORDS_KEPT = 20;
// LRCLIB answers 503 not only when it is busy but also for a song it does not have, so that is "nothing found" too.
const NOT_FOUND = new Set([404, 503]);
/** How long LRCLIB is left alone after a 429 that does not say for how long. */
const DEFAULT_BACK_OFF_MS = 60_000;

const time = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/** One line of a Lyricsfile as a line of LRC, or null when it has no start time. */
function lyricsfileLine(value: unknown): string | null {
  const line = record(value);
  const start = time(line['start_ms']);
  if (start === undefined) return null;
  let timed = '';
  let end = time(line['end_ms']);
  const words = list(line['words']);
  for (const item of words) {
    const word = record(item);
    const wordStart = time(word['start_ms']);
    if (wordStart === undefined) continue;
    timed += `<${lrcTime(wordStart)}>${text(word['text'])}`;
    end = time(word['end_ms']) ?? time(line['end_ms']);
  }
  if (!timed) return `[${lrcTime(start)}]${text(line['text'])}`;
  const lineEnd = end === undefined ? '' : `<${lrcTime(end)}>`;
  return `[${lrcTime(start)}]${timed}${lineEnd}`;
}

/**
 * LRCLIB's own lyrics format as LRC. A Lyricsfile is YAML with `lines`, each a `text` and a `start_ms`, and in a
 * word-timed one `words` with a `text` and a `start_ms` each; those lines get a `<mm:ss.xxx>` tag before each word and
 * one where the line ends. Empty when `yaml` is not a Lyricsfile.
 */
export function lyricsfileToLrc(yaml: string): string {
  let document: unknown;
  try {
    document = parse(yaml);
  } catch {
    return '';
  }
  return list(record(document)['lines'])
    .map(line => lyricsfileLine(line))
    .filter(line => line !== null)
    .join('\n');
}

/** A song as a search result (`has…` flags) or as a full record (the lyrics themselves) tells of it. */
function candidateOf(value: unknown): Candidate {
  const song = record(value);
  const hasLyrics = (flag: string, lyrics: string): boolean => song[flag] === true || text(song[lyrics]) !== '';
  const seconds = count(song['duration']);
  return {
    id: String(song['id']),
    title: text(song['trackName']),
    artist: text(song['artistName']),
    ...(seconds !== undefined && { durationMs: Math.round(seconds * 1000) }),
    has: {
      words: song['hasWordSync'] === true,
      lines: hasLyrics('hasSyncedLyrics', 'syncedLyrics'),
      plain: hasLyrics('hasPlainLyrics', 'plainLyrics')
    },
    isInstrumental: song['instrumental'] === true
  };
}

/** Settles when `request` does, whether it succeeds or fails: its own caller handles a failure. */
async function answered(request: Promise<unknown>): Promise<void> {
  try {
    await request;
  } catch {
    // Handled by whoever made the request.
  }
}

/**
 * LRCLIB as a source. Its requests go out one at a time, so lookups that overlap (songs skipped in a row) do not hit it
 * all at once. When LRCLIB answers 429, or asks to be left alone for a while (a Retry-After on an error), it is not
 * called until then, as its terms require: that is logged once, and each request until then fails at once, with a
 * SourceResting that findLyrics does not log again. A request that was waiting its turn when the 429 came is not sent
 * either. `now` is the clock, for tests.
 */
export function lrclibSource(now: () => number = () => Date.now()): LyricsSource {
  let waitUntil = 0;
  let queue: Promise<void> = Promise.resolve();
  const records = new Map<string, Promise<Record<string, unknown>>>();

  const send = async (path: string, get: GetJson): Promise<unknown> => {
    if (now() < waitUntil) throw new SourceResting('lrclib.net asked not to be called for a while');
    try {
      return await get(`${API}/${path}`, HEADERS);
    } catch (error) {
      if (!(error instanceof HttpError) || (error.status !== 429 && error.retryAfterMs === undefined)) throw error;
      const wait = error.retryAfterMs ?? DEFAULT_BACK_OFF_MS;
      waitUntil = now() + wait;
      console.warn(`lyrics: lrclib.net answered ${error.status}; not calling it for ${Math.ceil(wait / 1000)} s`);
      throw error.status === 429 ? new SourceResting(error.message, { cause: error }) : error;
    }
  };

  /** `send`, after the requests before it have been answered. */
  const ask = (path: string, get: GetJson): Promise<unknown> => {
    const before = queue;
    const turn = (async () => {
      await before;
      return send(path, get);
    })();
    queue = answered(turn);
    return turn;
  };

  /** A failure is not kept: the next kind of lyrics asked for tries again. */
  const forgetIfFailed = async (id: string, found: Promise<unknown>): Promise<void> => {
    try {
      await found;
    } catch {
      records.delete(id);
    }
  };

  const remember = (id: string, found: Promise<Record<string, unknown>>): void => {
    records.set(id, found);
    if (records.size > RECORDS_KEPT) records.delete(records.keys().next().value ?? id);
    void forgetIfFailed(id, found);
  };

  const fetchRecord = async (id: string, get: GetJson): Promise<Record<string, unknown>> =>
    record(await ask(`get/${encodeURIComponent(id)}`, get));

  /** The song's full record: every kind of lyrics LRCLIB has for it. */
  const recordOf = (candidate: Candidate, get: GetJson): Promise<Record<string, unknown>> => {
    const known = records.get(candidate.id);
    if (known) return known;
    const found = fetchRecord(candidate.id, get);
    remember(candidate.id, found);
    return found;
  };

  return {
    name: 'LRCLIB',
    async search(query, get) {
      const params = new URLSearchParams({ track_name: query.title, artist_name: query.artist });
      // The search that names the songs and the kinds of lyrics each has, without sending the lyrics.
      const found = list(await ask(`v2/search?${params}`, get)).map(song => candidateOf(song));
      if (found.length > 0) return found;
      // Not found by search: the lookup by title, artist and length, which also tells LRCLIB the song is wanted (it
      // may then fetch it from elsewhere, for a later request).
      if (query.durationMs) params.set('duration', String(Math.round(query.durationMs / 1000)));
      try {
        const exact = record(await ask(`get?${params}`, get));
        const candidate = candidateOf(exact);
        remember(candidate.id, Promise.resolve(exact));
        return [candidate];
      } catch (error) {
        if (error instanceof HttpError && NOT_FOUND.has(error.status)) return [];
        throw error;
      }
    },
    async words(candidate, get) {
      return lyricsfileToLrc(text((await recordOf(candidate, get))['lyricsfile'])) || null;
    },
    async lines(candidate, get) {
      return text((await recordOf(candidate, get))['syncedLyrics']) || null;
    },
    async plain(candidate, get) {
      return text((await recordOf(candidate, get))['plainLyrics']) || null;
    }
  };
}

export const lrclib: LyricsSource = lrclibSource();
