// Lyrics from the kiosk's own service, which is where every lyrics source is asked (pi/kiosk-audio/lyrics.ts): LRCLIB,
// Musixmatch, NetEase, QQ Music and KuGou. The service answers with synced lyrics as LRC text, with plain lyrics, or
// that the song is instrumental.
import { KIOSK_SERVICE } from '../utils/kioskService';
import { parseLrc } from './lrc';
import type { LyricsProvider } from './types';

// The service asks four sites, each with several requests and some of them one after the other, which can take a while.
const TIMEOUT_MS = 30_000;
// Skipping through songs would start a lookup for each one, and every lookup keeps going on the Pi once started, so
// LRCLIB and the others start refusing. A song is only looked up once it has stayed on for this long.
const SETTLE_MS = 400;

/** Waits `SETTLE_MS`, or less if `signal` is cancelled first. */
function settle(signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const stop = () => resolve();
    signal.addEventListener('abort', stop, { once: true });
    setTimeout(() => {
      signal.removeEventListener('abort', stop);
      resolve();
    }, SETTLE_MS);
  });
}

/**
 * Asks the kiosk service for lyrics. Off the kiosk (a dev machine, a preview) there is no service to ask, which is the
 * same as having no lyrics there, not a failure.
 */
export const kioskLyrics: LyricsProvider = async (query, signal) => {
  await settle(signal);
  signal.throwIfAborted();
  const params = new URLSearchParams({ title: query.title, artist: query.artist });
  if (query.durationMs) params.set('duration', String(query.durationMs));
  let response: Response;
  try {
    response = await fetch(`${KIOSK_SERVICE}/lyrics?${params}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)])
    });
  } catch (error) {
    if (signal.aborted) throw error;
    return null;
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`The kiosk could not look up lyrics (${response.status}).`);
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const source = typeof body?.['source'] === 'string' ? body['source'] : 'Kiosk';
  if (body?.['instrumental'] === true) return { kind: 'instrumental', source };
  if (typeof body?.['lrc'] === 'string') {
    const lines = parseLrc(body['lrc']);
    if (lines.some(line => line.text)) return { kind: 'synced', lines, source };
  }
  if (typeof body?.['plain'] === 'string') {
    const lines = body['plain'].split(/\r?\n/).map(line => line.trim());
    if (lines.some(Boolean)) return { kind: 'plain', lines, source };
  }
  return null;
};
