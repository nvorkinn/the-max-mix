// Finds synced lyrics for the app's GET /lyrics (server.ts): asks each source in lyrics-sources.ts in turn, only keeps a
// song that matches the title, artist and length asked for, and remembers the answers.
import { getJson, SOURCES } from './lyrics-sources.ts';
import type { Candidate, GetJson, LyricsQuery, LyricsSource } from './lyrics-sources.ts';

/** What the app gets back: the LRC text, and which source it came from. */
export interface LyricsHit {
  source: string;
  lrc: string;
}

const MAX_TEXT = 200;
/** A song whose length is further off than this is probably another recording. */
const MAX_DURATION_DIFF_MS = 6000;
/** How many of a source's best matches are tried before moving on to the next source. */
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

/**
 * The synced lyrics of the song from the first source that has them. A source that fails is skipped; when none has the
 * song and one failed, that failure is thrown so the app can tell "no lyrics" from "could not look".
 */
export async function findLyrics(
  query: LyricsQuery,
  sources: readonly LyricsSource[] = SOURCES,
  get: GetJson = getJson
): Promise<LyricsHit | null> {
  let failure: Error | undefined;
  for (const source of sources) {
    try {
      // One source at a time on purpose: the later ones are only asked when the earlier ones have nothing.
      // eslint-disable-next-line no-await-in-loop
      const hit = await fromSource(source, query, get);
      if (hit) return hit;
    } catch (error) {
      failure ??= error instanceof Error ? error : new Error(String(error));
      console.warn(`lyrics: ${source.name} failed: ${String(error)}`);
    }
  }
  if (failure) throw failure;
  return null;
}

async function fromSource(source: LyricsSource, query: LyricsQuery, get: GetJson): Promise<LyricsHit | null> {
  const found = matches(await source.search({ ...query, title: searchTitle(query.title) }, get), query).slice(
    0,
    TRIES_PER_SOURCE
  );
  for (const candidate of found) {
    // eslint-disable-next-line no-await-in-loop
    const lrc = await source.lyrics(candidate, get);
    if (lrc && isSynced(lrc)) return { source: source.name, lrc };
  }
  return null;
}

/** `find`, remembering what it found (for good) and what it did not (for an hour); failures are not remembered. */
export function cached(
  find: (query: LyricsQuery) => Promise<LyricsHit | null>,
  now: () => number = () => Date.now()
): (query: LyricsQuery) => Promise<LyricsHit | null> {
  const memory = new Map<string, { hit: LyricsHit | null; at: number }>();
  return async query => {
    const key = `${normalize(query.title)}\n${normalize(query.artist)}\n${Math.round((query.durationMs ?? 0) / 5000)}`;
    const known = memory.get(key);
    if (known && (known.hit || now() - known.at < MISS_TTL_MS)) return known.hit;
    const hit = await find(query);
    memory.delete(key);
    memory.set(key, { hit, at: now() });
    if (memory.size > CACHE_LIMIT) memory.delete(memory.keys().next().value ?? key);
    return hit;
  };
}
