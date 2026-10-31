import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../test/deferred';
import {
  checkSpotifyRetryWindow,
  fetchSpotify,
  getSpotifyRetryAt,
  getSpotifyRetryDelay,
  recordSpotifyRetryAfter,
  spotifyRetryAfter,
  SpotifyApiError,
  subscribeSpotifyRetryAt
} from './http';

const response = (seconds: string) => Response.json({}, { status: 429, headers: { 'Retry-After': seconds } });

describe('shared Spotify Web API cooldown', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('keeps the maximum deadline from concurrent responses and notifies once at expiry', async () => {
    const longer = deferred<Response>();
    const shorter = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(longer.promise).mockReturnValueOnce(shorter.promise);
    vi.stubGlobal('fetch', fetchMock);
    const listener = vi.fn();
    const unsubscribe = subscribeSpotifyRetryAt(listener);
    try {
      const playback = fetchSpotify('https://api.spotify.com/v1/me/player', {});
      const devices = fetchSpotify('https://api.spotify.com/v1/me/player/devices', {});
      longer.resolve(response('40'));
      await playback;
      const retryAt = getSpotifyRetryAt();
      shorter.resolve(response('10'));
      await devices;
      expect(getSpotifyRetryAt()).toBe(retryAt);
      expect(listener).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(39_999);
      expect(getSpotifyRetryAt()).toBe(retryAt);
      await vi.advanceTimersByTimeAsync(1);
      expect(getSpotifyRetryAt()).toBe(0);
      expect(listener).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe();
    }
  });

  it('does not extend the deadline when a rounded remaining wait is recorded again', async () => {
    recordSpotifyRetryAfter(new SpotifyApiError('Rate limited', 429, 30));
    const retryAt = getSpotifyRetryAt();
    for (let count = 0; count < 5; count++) {
      vi.setSystemTime(Date.now() + 101);
      try {
        checkSpotifyRetryWindow();
      } catch (error) {
        if (!(error instanceof SpotifyApiError)) throw error;
        recordSpotifyRetryAfter(error);
      }
      expect(getSpotifyRetryAt()).toBe(retryAt);
    }
    await vi.advanceTimersByTimeAsync(retryAt - Date.now());
    expect(() => checkSpotifyRetryWindow()).not.toThrow();
  });

  it('checks expiry even if a background timer has not fired', () => {
    recordSpotifyRetryAfter(new SpotifyApiError('Rate limited', 429, 30));
    vi.setSystemTime(getSpotifyRetryAt());
    expect(() => checkSpotifyRetryWindow()).not.toThrow();
    expect(getSpotifyRetryAt()).toBe(0);
  });

  it('does not restore an already-expired error deadline', async () => {
    const error = new SpotifyApiError('Rate limited', 429, 30);
    recordSpotifyRetryAfter(error);
    await vi.advanceTimersByTimeAsync(30_000);
    recordSpotifyRetryAfter(error);
    expect(getSpotifyRetryAt()).toBe(0);
  });

  it('handles deadlines longer than the browser timer limit without expiring early', async () => {
    recordSpotifyRetryAfter(new SpotifyApiError('Rate limited', 429, 3_000_000));
    const retryAt = getSpotifyRetryAt();
    expect(getSpotifyRetryDelay()).toBe(2_147_483_647);
    await vi.advanceTimersByTimeAsync(2_147_483_647);
    expect(getSpotifyRetryAt()).toBe(retryAt);
    expect(() => checkSpotifyRetryWindow()).toThrow(SpotifyApiError);
    await vi.advanceTimersByTimeAsync(retryAt - Date.now());
    expect(getSpotifyRetryAt()).toBe(0);
  });

  it('does not block OAuth token requests or share their separate retry headers', async () => {
    recordSpotifyRetryAfter(new SpotifyApiError('Rate limited', 429, 30));
    const retryAt = getSpotifyRetryAt();
    const fetchMock = vi.fn().mockResolvedValue(response('90'));
    vi.stubGlobal('fetch', fetchMock);
    await fetchSpotify('https://accounts.spotify.com/api/token', { method: 'POST' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(getSpotifyRetryAt()).toBe(retryAt);
    await expect(fetchSpotify('https://api.spotify.com/v1/me/player', {})).rejects.toMatchObject({
      status: 429,
      retryAt,
      message: 'Spotify asked this app to wait before retrying.'
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('accepts an HTTP-date Retry-After without rounding its absolute deadline', async () => {
    const retryAt = Math.floor(Date.now() / 1000) * 1000 + 30_000;
    const reply = response(new Date(retryAt).toUTCString());
    expect(spotifyRetryAfter(reply)).toBe(Math.ceil((retryAt - Date.now()) / 1000));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply));
    await fetchSpotify('https://api.spotify.com/v1/me/player', {});
    expect(getSpotifyRetryAt()).toBe(retryAt);
  });

  it.each(['', ' ', 'soon', '-3', '0', 'Infinity', '1e308'])('ignores invalid or expired Retry-After %s', header => {
    expect(spotifyRetryAfter(response(header))).toBe(0);
  });
});
