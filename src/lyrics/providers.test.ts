import { describe, expect, it, vi } from 'vitest';
import { firstOf } from './providers';
import type { Lyrics, LyricsProvider } from './types';

const query = { title: 'Placeholder Song', artist: 'Placeholder Artist' };
const found = (source: string): Lyrics => ({ kind: 'plain', lines: ['Placeholder'], source });

describe('lyrics/providers', () => {
  it('takes the first source with lyrics and does not ask the rest', async () => {
    const later = vi.fn<LyricsProvider>();
    const provider = firstOf(
      vi.fn<LyricsProvider>().mockResolvedValue(null),
      vi.fn<LyricsProvider>().mockResolvedValue(found('B')),
      later
    );
    await expect(provider(query, new AbortController().signal)).resolves.toEqual(found('B'));
    expect(later).not.toHaveBeenCalled();
  });

  it('skips a failing source but reports the failure when nothing was found', async () => {
    const failing = vi.fn<LyricsProvider>().mockRejectedValue(new Error('Source A is down.'));
    const signal = new AbortController().signal;
    const second = vi.fn<LyricsProvider>().mockResolvedValue(found('B'));
    await expect(firstOf(failing, second)(query, signal)).resolves.toEqual(found('B'));
    const nothing = vi.fn<LyricsProvider>().mockResolvedValue(null);
    await expect(firstOf(failing, nothing)(query, signal)).rejects.toThrow('Source A is down.');
    await expect(firstOf(nothing)(query, signal)).resolves.toBeNull();
    const thrown = firstOf(vi.fn<LyricsProvider>().mockRejectedValue('plain text'));
    await expect(thrown(query, signal)).rejects.toThrow('plain text');
  });

  it('stops at a cancellation', async () => {
    const controller = new AbortController();
    const abort = new DOMException('Aborted', 'AbortError');
    const next = vi.fn<LyricsProvider>();
    const first = vi.fn<LyricsProvider>().mockImplementation(() => {
      controller.abort();
      return Promise.reject(abort);
    });
    await expect(firstOf(first, next)(query, controller.signal)).rejects.toBe(abort);
    expect(next).not.toHaveBeenCalled();
  });
});
