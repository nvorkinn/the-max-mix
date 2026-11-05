// Synced lyrics from the sources only the kiosk's own service can reach (NetEase, QQ Music, KuGou: they do not allow
// requests from a web page). The service (pi/kiosk-audio/lyrics.ts) finds them and answers with LRC text.
import { KIOSK_SERVICE } from '../utils/kioskService';
import { parseLrc } from './lrc';
import type { LyricsProvider } from './types';

// The service calls three sites one after the other, which can take a while.
const TIMEOUT_MS = 30_000;

/**
 * Asks the kiosk service for synced lyrics. Off the kiosk (a dev machine, a preview) there is no service to ask, which
 * is the same as having no lyrics there, not a failure.
 */
export const kioskLyrics: LyricsProvider = async (query, signal) => {
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
  const body = (await response.json().catch(() => null)) as { source?: unknown; lrc?: unknown } | null;
  if (typeof body?.lrc !== 'string') return null;
  const lines = parseLrc(body.lrc);
  if (lines.every(line => !line.text)) return null;
  return { kind: 'synced', lines, source: typeof body.source === 'string' ? body.source : 'Kiosk' };
};
