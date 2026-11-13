import { afterEach, describe, expect, it, vi } from 'vitest';
import { bestLyrics } from './providers';
import type { Lyrics, LyricsProvider } from './types';

const query = { title: 'Placeholder Song', artist: 'Placeholder Artist' };
const found = (source: string): Lyrics => ({ kind: 'synced', lines: [{ timeMs: 0, text: 'Placeholder' }], source });
const worded = (source: string): Lyrics => ({
  kind: 'synced',
  lines: [{ timeMs: 0, text: 'Placeholder', words: [{ timeMs: 0, text: 'Placeholder' }] }],
  source
});
const plain = (source: string): Lyrics => ({ kind: 'plain', lines: ['Placeholder'], source });
const answer = (lyrics: Lyrics | null) => vi.fn<LyricsProvider>().mockResolvedValue(lyrics);
const failing = (reason: unknown) => vi.fn<LyricsProvider>().mockRejectedValue(reason);
const never = () => vi.fn<LyricsProvider>().mockReturnValue(new Promise(() => {}));
const signal = new AbortController().signal;

const [syncedA, syncedB, syncedC] = [found('A'), found('B'), found('C')];
const [wordedA, wordedB] = [worded('A'), worded('B')];
const plainA = plain('A');

/** The best lyrics of `providers`, waiting a second for word timing. */
const best = async (...providers: LyricsProvider[]) => bestLyrics(1000, ...providers)(query, signal);

afterEach(() => vi.useRealTimers());

describe('lyrics/providers', () => {
  it('asks every source at once and takes the first synced lyrics when none times each word', async () => {
    const later = answer(syncedC);
    await expect(best(answer(null), answer(syncedB), later)).resolves.toEqual(syncedB);
    expect(later).toHaveBeenCalledWith(query, signal);
  });

  it('prefers a later source that times each word', async () => {
    await expect(best(answer(syncedA), answer(wordedB))).resolves.toEqual(wordedB);
    await expect(best(answer(plainA), answer(wordedB))).resolves.toEqual(wordedB);
    await expect(best(answer(wordedA), never())).resolves.toEqual(wordedA);
  });

  it('waits only a little for word timing once synced lyrics are in', async () => {
    vi.useFakeTimers();
    let settled = false;
    const result = bestLyrics(4000, answer(syncedA), never())(query, signal);
    void result.finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(3999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual(syncedA);
  });

  it('skips a failing source but reports the failure when nothing was found', async () => {
    const down = failing(new Error('Source A is down.'));
    await expect(best(down, answer(syncedB))).resolves.toEqual(syncedB);
    await expect(best(down, answer(null))).rejects.toThrow('Source A is down.');
    await expect(best(answer(null))).resolves.toBeNull();
    await expect(best(failing('plain text'))).rejects.toThrow('plain text');
  });

  it('stops at a cancellation', async () => {
    const controller = new AbortController();
    const abort = new DOMException('Aborted', 'AbortError');
    const first = vi.fn<LyricsProvider>().mockImplementation(() => {
      controller.abort();
      return Promise.reject(abort);
    });
    const provider = bestLyrics(1000, first, answer(syncedB));
    await expect(provider(query, controller.signal)).rejects.toBe(abort);
  });

  it('prefers synced lyrics from a later source to plain ones, which are the fallback', async () => {
    await expect(best(answer(plainA), answer(syncedB))).resolves.toEqual(syncedB);
    await expect(best(answer(plainA), answer(null))).resolves.toEqual(plainA);
    const down = failing(new Error('B is down.'));
    await expect(best(answer(plainA), down)).resolves.toEqual(plainA);
  });

  it('takes instrumental at once', async () => {
    const instrumental: Lyrics = { kind: 'instrumental', source: 'A' };
    await expect(best(answer(instrumental), never())).resolves.toEqual(instrumental);
  });
});
