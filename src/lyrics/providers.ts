import { kioskLyrics } from './kiosk';
import { lrclib } from './lrclib';
import type { Lyrics, LyricsProvider } from './types';

/** How long the later sources get to send word-timed lyrics once an earlier one has found line-timed ones. */
export const WORD_TIMING_WAIT_MS = 4000;

const hasWordTiming = (lyrics: Lyrics): boolean =>
  lyrics.kind === 'synced' && lyrics.lines.some(line => line.words && line.words.length > 0);

/**
 * A provider that asks all of `providers` at once and takes, by their order: the first lyrics timed word by word, else
 * the first synced lyrics, else the first plain ones. Once one has synced lyrics, the later ones get `waitMs` more to
 * come up with word timing, so a slow source cannot hold the lyrics back for long. Instrumental found before any synced
 * lyrics is final. A source that fails is skipped; if none found lyrics and one failed, that failure is reported so the
 * panel can offer to try again.
 */
export function bestLyrics(waitMs: number, ...providers: LyricsProvider[]): LyricsProvider {
  return async (query, signal) => {
    type Outcome = { lyrics: Lyrics | null } | { error: unknown };
    const outcomes = providers.map(async (provider): Promise<Outcome> =>
      provider(query, signal)
        .then(lyrics => ({ lyrics }))
        .catch((error: unknown) => ({ error }))
    );
    let failure: Error | undefined;
    let synced: Lyrics | undefined;
    let plain: Lyrics | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let deadline: Promise<'late'> | undefined;
    try {
      for (const pending of outcomes) {
        // In order on purpose: an earlier source wins a tie, and a later one is only waited for while it could win.
        // eslint-disable-next-line no-await-in-loop
        const outcome = await (deadline ? Promise.race([pending, deadline]) : pending);
        if (outcome === 'late') break;
        if ('error' in outcome) {
          if (signal.aborted) throw outcome.error;
          failure ??= outcome.error instanceof Error ? outcome.error : new Error(String(outcome.error));
          continue;
        }
        const { lyrics } = outcome;
        if (!lyrics) continue;
        if ((!synced && lyrics.kind === 'instrumental') || hasWordTiming(lyrics)) return lyrics;
        if (lyrics.kind === 'plain') plain ??= lyrics;
        else if (!synced && lyrics.kind === 'synced') {
          synced = lyrics;
          deadline = new Promise(resolve => {
            timer = setTimeout(() => resolve('late'), waitMs);
          });
        }
      }
    } finally {
      clearTimeout(timer);
    }
    if (signal.aborted) throw signal.reason;
    if (synced ?? plain) return synced ?? plain ?? null;
    if (failure) throw failure;
    return null;
  };
}

/**
 * The sources the app asks, in order: LRCLIB, then the kiosk's own service for NetEase, QQ Music and KuGou (which is
 * the one that can time each word). Add another provider here to fill in songs these do not have.
 */
export const defaultLyricsProvider: LyricsProvider = bestLyrics(WORD_TIMING_WAIT_MS, lrclib, kioskLyrics);
