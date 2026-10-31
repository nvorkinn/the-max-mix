import { useEffect, useState } from 'react';
import { defaultLyricsProvider } from '../lyrics/providers';
import type { Lyrics, LyricsProvider, LyricsQuery } from '../lyrics/types';
import type { Track } from '../types';
import { errorMessage } from '../utils/errorMessage';

type LyricsStatus = 'idle' | 'loading' | 'ready' | 'missing' | 'error';

interface UseLyrics {
  status: LyricsStatus;
  lyrics: Lyrics | null;
  error: string | null;
  retry: () => void;
}

// Lyrics found (or known to be missing) per track, so going back to a song or reopening the panel costs no request.
const CACHE_LIMIT = 50;
const cache = new Map<string, Lyrics | null>();

function remember(key: string, lyrics: Lyrics | null) {
  cache.delete(key);
  cache.set(key, lyrics);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value ?? key);
}

/** Forgets every looked-up track; for tests. */
export function clearLyricsCache() {
  cache.clear();
}

function toQuery(track: Track | undefined): LyricsQuery | null {
  const title = track?.name || track?.title;
  const artist = track?.artists?.[0]?.name || track?.artist;
  return title && artist ? { title, artist, ...(track.duration_ms && { durationMs: track.duration_ms }) } : null;
}

/**
 * The lyrics of `track`, looked up only while `enabled` (the lyrics panel is open) so a closed panel makes no requests.
 * A track change cancels the lookup for the previous one.
 */
export function useLyrics(
  track: Track | undefined,
  enabled: boolean,
  provider: LyricsProvider = defaultLyricsProvider
): UseLyrics {
  const query = toQuery(track);
  const key = query ? (track?.id ?? `${query.title}\n${query.artist}`) : null;
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [found, setFound] = useState<{ key: string; lyrics: Lyrics | null } | null>(null);

  const title = query?.title;
  const artist = query?.artist;
  const durationMs = query?.durationMs;
  useEffect(() => {
    if (!enabled || !key || !title || !artist || cache.has(key)) return;
    const controller = new AbortController();
    provider({ title, artist, ...(durationMs && { durationMs }) }, controller.signal)
      .then(lyrics => {
        if (controller.signal.aborted) return;
        remember(key, lyrics);
        setFailure(null);
        setFound({ key, lyrics });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setFailure({ key, message: errorMessage(error) });
      });
    return () => controller.abort();
  }, [enabled, key, title, artist, durationMs, provider, attempt]);

  const retry = () => {
    setFailure(null);
    setAttempt(count => count + 1);
  };

  if (!enabled || !key) return { status: 'idle', lyrics: null, error: null, retry };
  // Undefined until the source has answered for this track; null when it has no lyrics for it.
  const lyrics = found?.key === key ? found.lyrics : cache.get(key);
  if (lyrics !== undefined) return { status: lyrics ? 'ready' : 'missing', lyrics, error: null, retry };
  return failure?.key === key
    ? { status: 'error', lyrics: null, error: failure.message, retry }
    : { status: 'loading', lyrics: null, error: null, retry };
}
