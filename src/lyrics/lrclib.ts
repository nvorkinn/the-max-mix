// LRCLIB (https://lrclib.net) is a free, open lyrics database with time-synced lyrics. It needs no key and allows
// requests from any origin, so the browser can call it directly; this app has no backend.
import { isRecord } from '../spotify/parse';
import { parseLrc } from './lrc';
import type { Lyrics, LyricsProvider, LyricsQuery } from './types';

const API = 'https://lrclib.net/api';
const SOURCE = 'LRCLIB';
// LRCLIB asks clients to name themselves; browsers will not let a page set User-Agent, so this header carries it.
const HEADERS = { 'Lrclib-Client': 'THE MAX MIX (https://github.com/nvorkinn/the-max-mix)' };
// A search hit whose length is further off than this is probably another recording.
const MAX_DURATION_DIFF_S = 10;

interface LrclibRecord {
  duration?: number;
  instrumental: boolean;
  plainLyrics?: string;
  syncedLyrics?: string;
}

function parseRecord(value: unknown): LrclibRecord | undefined {
  if (!isRecord(value)) return undefined;
  const record: LrclibRecord = { instrumental: value['instrumental'] === true };
  if (typeof value['duration'] === 'number') record.duration = value['duration'];
  if (typeof value['plainLyrics'] === 'string') record.plainLyrics = value['plainLyrics'];
  if (typeof value['syncedLyrics'] === 'string') record.syncedLyrics = value['syncedLyrics'];
  return record;
}

/** The app's lyrics from an LRCLIB record, preferring synced lines; null when it has neither kind. */
function toLyrics(record: LrclibRecord): Lyrics | null {
  if (record.instrumental) return { kind: 'instrumental', source: SOURCE };
  const synced = record.syncedLyrics ? parseLrc(record.syncedLyrics) : [];
  if (synced.some(line => line.text)) return { kind: 'synced', lines: synced, source: SOURCE };
  const plain = record.plainLyrics?.split(/\r?\n/).map(line => line.trim()) ?? [];
  return plain.some(Boolean) ? { kind: 'plain', lines: plain, source: SOURCE } : null;
}

// LRCLIB answers 503 "ServerOverloaded" not only when it is busy but also for a song it does not have (it then tries
// to fetch it from elsewhere and gives up), so a 503 counts as "nothing found" and the next lookup is tried.
const NOT_FOUND = new Set([404, 503]);

async function request(path: string, params: Record<string, string>, signal: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${API}/${path}?${new URLSearchParams(params)}`, {
      headers: HEADERS,
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)])
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error('Could not reach the lyrics service.', { cause: error });
  }
  if (NOT_FOUND.has(response.status)) return null;
  if (!response.ok) throw new Error(`The lyrics service answered ${response.status}.`);
  return response.json().catch(() => null);
}

/** The best search hit: synced lyrics first, then plain; within each, LRCLIB's own ranking. */
function bestMatch(found: unknown, seconds: number | undefined): Lyrics | null {
  const candidates = (Array.isArray(found) ? found : [])
    .map(record => parseRecord(record))
    .filter((record): record is LrclibRecord => record !== undefined)
    .filter(
      record =>
        seconds === undefined ||
        record.duration === undefined ||
        Math.abs(record.duration - seconds) <= MAX_DURATION_DIFF_S
    );
  for (const record of [...candidates.filter(entry => entry.syncedLyrics), ...candidates]) {
    const lyrics = toLyrics(record);
    if (lyrics) return lyrics;
  }
  return null;
}

/**
 * Looks a track up in LRCLIB's own database by exact title, artist and length, then by a search for the closest match,
 * and only then with the lookup that may make LRCLIB fetch the song from elsewhere (slow, and often a 503).
 */
export const lrclib: LyricsProvider = async (query: LyricsQuery, signal: AbortSignal) => {
  const params: Record<string, string> = { track_name: query.title, artist_name: query.artist };
  if (query.album) params['album_name'] = query.album;
  const seconds = query.durationMs ? Math.round(query.durationMs / 1000) : undefined;
  if (seconds) params['duration'] = String(seconds);
  const exact = async (path: string) => {
    const record = parseRecord(await request(path, params, signal));
    return record ? toLyrics(record) : null;
  };

  return (
    (await exact('get-cached')) ??
    bestMatch(await request('search', { track_name: query.title, artist_name: query.artist }, signal), seconds) ??
    (await exact('get'))
  );
};
