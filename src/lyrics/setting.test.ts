import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadShowLyrics, saveShowLyrics } from './setting';

describe('lyrics setting', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('is off until turned on and remembers the choice', () => {
    expect(loadShowLyrics()).toBe(false);
    saveShowLyrics(true);
    expect(localStorage.getItem('maxmix_lyrics')).toBe('on');
    expect(loadShowLyrics()).toBe(true);
    saveShowLyrics(false);
    expect(loadShowLyrics()).toBe(false);
  });

  it('tolerates storage that is not available', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadShowLyrics()).toBe(false);
    expect(() => saveShowLyrics(true)).not.toThrow();
  });
});
