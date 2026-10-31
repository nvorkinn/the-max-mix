import { lrclib } from './lrclib';
import type { LyricsProvider } from './types';

/**
 * A provider that asks each of `providers` in turn and takes the first lyrics found. A source that fails is skipped;
 * if none found lyrics and one failed, that failure is reported so the panel can offer to try again.
 */
export function firstOf(...providers: LyricsProvider[]): LyricsProvider {
  return async (query, signal) => {
    let failure: Error | undefined;
    for (const provider of providers) {
      try {
        // One source at a time on purpose: the later ones are only asked when the earlier ones have nothing.
        // eslint-disable-next-line no-await-in-loop
        const lyrics = await provider(query, signal);
        if (lyrics) return lyrics;
      } catch (error) {
        if (signal.aborted) throw error;
        failure ??= error instanceof Error ? error : new Error(String(error));
      }
    }
    if (failure) throw failure;
    return null;
  };
}

/** The sources the app asks, in order. Add another provider here to fill in songs LRCLIB does not have. */
export const defaultLyricsProvider: LyricsProvider = firstOf(lrclib);
