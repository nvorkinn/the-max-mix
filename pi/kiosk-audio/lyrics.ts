// Finds lyrics for the app's GET /lyrics (server.ts), which is the app's only way to lyrics. Every source (LRCLIB,
// Musixmatch, and the three in lyrics-sources.ts) is asked for lyrics timed word by word; only when none has them is
// each asked in turn for line-timed ones, and after those for plain ones. It only keeps a song that matches the title,
// artist and length asked for, and remembers the answers.
import { lrclib } from './lyrics-lrclib.ts';
import { musixmatch } from './lyrics-musixmatch.ts';
import { getJson, kugou, netease, qqMusic } from './lyrics-sources.ts';
import type { Candidate, GetJson, LyricsQuery, LyricsSource } from './lyrics-sources.ts';

/**
 * The sources, in the order they are asked. LRCLIB is first: its lyrics are without the credit lines the others put
 * at the top, and it is the one that has plain lyrics and knows the instrumental songs. Musixmatch is next: it has the
 * most songs sung in English, many of them timed word by word.
 */
const SOURCES: readonly LyricsSource[] = [lrclib, musixmatch, netease, qqMusic, kugou];

/**
 * What the app gets back, with the source it came from: synced lyrics as LRC text (with a time before each word when
 * the source times those), else lyrics without times, else that the song has no lyrics to show.
 */
export type LyricsHit =
  { source: string; lrc: string } | { source: string; plain: string } | { source: string; instrumental: true };

const MAX_TEXT = 200;
/** A song whose length is further off than this is probably another recording. */
const MAX_DURATION_DIFF_MS = 6000;
/** How many of a source's best matches are asked for one kind of lyrics before moving on to the next source. */
const TRIES_PER_SOURCE = 3;
const MIN_TIMED_LINES = 4;
const CACHE_LIMIT = 300;
const MISS_TTL_MS = 60 * 60 * 1000;

/** The body of a GET /lyrics as a query, or null when it lacks a title or artist. */
export function parseLyricsQuery(params: URLSearchParams): LyricsQuery | null {
  const title = params.get('title')?.trim().slice(0, MAX_TEXT);
  const artist = params.get('artist')?.trim().slice(0, MAX_TEXT);
  if (!title || !artist) return null;
  const duration = Number(params.get('duration'));
  return Number.isFinite(duration) && duration > 0 ? { title, artist, durationMs: duration } : { title, artist };
}

const VERSION_WORDS = /remaster|version|mix|mono|stereo|live|edit|single/i;

/** "Song - Remastered 2009" as "Song". */
function withoutVersion(value: string): string {
  const dash = value.search(/\s[-–—]\s/);
  return dash !== -1 && VERSION_WORDS.test(value.slice(dash)) ? value.slice(0, dash) : value;
}

/** "Artist feat. Someone" as "Artist". */
const withoutCredits = (value: string): string => value.split(/\b(?:feat|ft|featuring)\b/, 1)[0] ?? value;

const OPENING = '([{（【';
const CLOSING = ')]}）】';

/** "Song (Deluxe) [Live]" as "Song  ". */
function withoutBrackets(value: string): string {
  let depth = 0;
  let kept = '';
  for (const character of value) {
    if (OPENING.includes(character)) depth += 1;
    else if (CLOSING.includes(character)) depth = Math.max(0, depth - 1);
    else kept += depth === 0 ? character : '';
  }
  return kept;
}

/** Lower case, without accents, brackets, "feat." credits, "- Remastered" suffixes and punctuation. */
export function normalize(value: string): string {
  const withoutSuffix = withoutVersion(value.toLowerCase());
  return withoutBrackets(withoutCredits(withoutSuffix))
    .normalize('NFKD')
    .replaceAll(/[̀-ͯ]/g, '')
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The title as the sources are searched for it: without "- Remastered 2009" or "(feat. …)", which only skew a search. */
export function searchTitle(title: string): string {
  return withoutBrackets(withoutVersion(title)).replaceAll(/\s+/g, ' ').trim() || title;
}

const isSimilar = (a: string, b: string): boolean => a !== '' && b !== '' && (a.includes(b) || b.includes(a));

/** The candidates that are the song asked for, best first: the exact title, then the closest length. */
export function matches(candidates: readonly Candidate[], query: LyricsQuery): Candidate[] {
  const title = normalize(query.title);
  const artist = normalize(query.artist);
  const ranked: { candidate: Candidate; exact: boolean; diff: number }[] = [];
  for (const candidate of candidates) {
    const found = normalize(candidate.title);
    const isExact = found === title;
    const diff =
      query.durationMs === undefined || candidate.durationMs === undefined
        ? 0
        : Math.abs(candidate.durationMs - query.durationMs);
    if (
      (isExact || isSimilar(found, title)) &&
      isSimilar(normalize(candidate.artist), artist) &&
      diff <= MAX_DURATION_DIFF_MS
    ) {
      ranked.push({ candidate, exact: isExact, diff });
    }
  }
  return ranked.toSorted((a, b) => Number(b.exact) - Number(a.exact) || a.diff - b.diff).map(entry => entry.candidate);
}

/** Whether `lrc` has enough time-stamped lines to be synced lyrics (not a stub or a plain text). */
export function isSynced(lrc: string): boolean {
  let timed = 0;
  for (const line of lrc.split('\n')) {
    const stamp = /^\[\d{1,3}:\d{1,2}[^\]]{0,8}\]/.exec(line.trim());
    if (stamp && line.trim().slice(stamp[0].length).trim() !== '') timed += 1;
  }
  return timed >= MIN_TIMED_LINES;
}

const TIMED_WORD = /<\d{1,3}:\d{1,2}[^>]{0,8}>[^<]/g;

/**
 * Whether `lrc` is synced lyrics that time each word: enough of its lines have two or more timed words. A source can
 * have "word-timed" lyrics that only time whole lines, which are no better than line-timed ones.
 */
export function isWordTimed(lrc: string): boolean {
  const lines = lrc.split('\n').filter(line => (line.match(TIMED_WORD)?.length ?? 0) >= 2);
  return isSynced(lrc) && lines.length >= MIN_TIMED_LINES;
}

type Kind = 'words' | 'lines' | 'plain';

const ACCEPTS: Record<Kind, (lyrics: string) => boolean> = {
  words: isWordTimed,
  lines: isSynced,
  plain: lyrics => lyrics.trim() !== ''
};

/** A source and the songs its search found that are the one asked for, best first. */
interface Searched {
  source: LyricsSource;
  found: Candidate[];
}

/** One kind of lyrics from a source: those of the first of its best matches that has good ones, or null. */
async function ask(kind: Kind, { source, found }: Searched, get: GetJson): Promise<string | null> {
  const read = source[kind];
  if (!read) return null;
  const candidates = found.filter(candidate => candidate.has?.[kind] !== false).slice(0, TRIES_PER_SOURCE);
  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop -- a later match is only asked when the earlier ones have nothing.
    const lyrics = await read(candidate, get);
    if (lyrics && ACCEPTS[kind](lyrics)) return lyrics;
  }
  return null;
}

/**
 * The lyrics of the song, the best kind there is: word-timed ones from the first source that has them, else
 * line-timed ones, else plain ones. Every source is asked for word-timed lyrics before any is asked for another kind.
 * A source that knows the song as instrumental and has no synced lyrics for it settles it, unless an earlier source has
 * line-timed ones. A source that fails is skipped; when none has the song and one failed, that failure is thrown so
 * the app can tell "no lyrics" from "could not look".
 */
export async function findLyrics(
  query: LyricsQuery,
  sources: readonly LyricsSource[] = SOURCES,
  get: GetJson = getJson
): Promise<LyricsHit | null> {
  let failure: Error | undefined;
  const failed = (source: LyricsSource, error: unknown) => {
    failure ??= error instanceof Error ? error : new Error(String(error));
    console.warn(`lyrics: ${source.name} failed: ${String(error)}`);
  };
  const attempt = async (kind: Kind, searched: Searched): Promise<string | null> => {
    try {
      return await ask(kind, searched, get);
    } catch (error) {
      failed(searched.source, error);
      return null;
    }
  };
  // All sources at once, since each is asked whatever the others answer; an earlier source still wins a tie.
  const asked = sources.map(async source => {
    const searched: Searched = { source, found: [] };
    try {
      searched.found = matches(await source.search({ ...query, title: searchTitle(query.title) }, get), query);
    } catch (error) {
      failed(source, error);
    }
    return { searched, lrc: await attempt('words', searched) };
  });
  const wordless: Searched[] = [];
  for (const pending of asked) {
    // eslint-disable-next-line no-await-in-loop -- they are already running; this only takes them in order.
    const { searched, lrc } = await pending;
    if (lrc) return { source: searched.source.name, lrc };
    wordless.push(searched);
  }
  // One source at a time from here on purpose: the later ones are only asked when the earlier ones have nothing.
  for (const searched of wordless) {
    // eslint-disable-next-line no-await-in-loop
    const lrc = await attempt('lines', searched);
    if (lrc) return { source: searched.source.name, lrc };
    if (searched.found[0]?.isInstrumental) return { source: searched.source.name, instrumental: true };
  }
  for (const searched of wordless) {
    // eslint-disable-next-line no-await-in-loop
    const plain = await attempt('plain', searched);
    if (plain) return { source: searched.source.name, plain };
  }
  if (failure) throw failure;
  return null;
}

/**
 * `find`, remembering the synced lyrics it found (for good) and, for an hour, anything less: a song without lyrics or
 * with only plain ones may have synced ones later. Failures are not remembered.
 */
export function cached(
  find: (query: LyricsQuery) => Promise<LyricsHit | null>,
  now: () => number = () => Date.now()
): (query: LyricsQuery) => Promise<LyricsHit | null> {
  const memory = new Map<string, { hit: LyricsHit | null; at: number }>();
  return async query => {
    const key = `${normalize(query.title)}\n${normalize(query.artist)}\n${Math.round((query.durationMs ?? 0) / 5000)}`;
    const known = memory.get(key);
    if (known && ((known.hit && 'lrc' in known.hit) || now() - known.at < MISS_TTL_MS)) return known.hit;
    const hit = await find(query);
    memory.delete(key);
    memory.set(key, { hit, at: now() });
    if (memory.size > CACHE_LIMIT) memory.delete(memory.keys().next().value ?? key);
    return hit;
  };
}
