import { kioskLyrics } from './kiosk';
import { lrclib } from './lrclib';
import type { Lyrics, LyricsProvider } from './types';

/**
 * A provider that asks each of `providers` in turn and takes the first synced lyrics found, so a later source can still
 * beat an earlier one's plain text. Plain lyrics (the first found) are the fallback when none has synced ones, and
 * instrumental is final. A source that fails is skipped; if none found lyrics and one failed, that failure is reported
 * so the panel can offer to try again.
 */
export function syncedFirst(...providers: LyricsProvider[]): LyricsProvider {
  return async (query, signal) => {
    let failure: Error | undefined;
    let plain: Lyrics | undefined;
    for (const provider of providers) {
      try {
        // One source at a time on purpose: the later ones are only asked when the earlier ones have nothing better.
        // eslint-disable-next-line no-await-in-loop
        const lyrics = await provider(query, signal);
        if (lyrics?.kind === 'plain') plain ??= lyrics;
        else if (lyrics) return lyrics;
      } catch (error) {
        if (signal.aborted) throw error;
        failure ??= error instanceof Error ? error : new Error(String(error));
      }
    }
    if (plain) return plain;
    if (failure) throw failure;
    return null;
  };
}

/**
 * The sources the app asks, in order: LRCLIB, then the kiosk's own service for NetEase, QQ Music and KuGou. Add
 * another provider here to fill in songs these do not have.
 */
export const defaultLyricsProvider: LyricsProvider = syncedFirst(lrclib, kioskLyrics);
