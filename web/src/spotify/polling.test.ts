import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPollSpotify, getPollSpotifyNow, setPollSpotify, subscribePollSpotify } from './polling';

describe('polling setting', () => {
  afterEach(() => {
    setPollSpotify(true);
    vi.restoreAllMocks();
  });

  it('is on until turned off, remembers it and tells listeners', () => {
    expect(getPollSpotifyNow()).toBe(true);
    const listener = vi.fn();
    const stop = subscribePollSpotify(listener);
    setPollSpotify(false);
    expect(getPollSpotifyNow()).toBe(false);
    expect(getPollSpotify()).toBe(false);
    expect(localStorage.getItem('maxmix.pollSpotify')).toBe('off');
    setPollSpotify(true);
    expect(localStorage.getItem('maxmix.pollSpotify')).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    setPollSpotify(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('tolerates storage that is not available', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(getPollSpotify()).toBe(true);
    expect(() => setPollSpotify(false)).not.toThrow();
    expect(getPollSpotifyNow()).toBe(false);
  });
});
