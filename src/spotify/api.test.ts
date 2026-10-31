import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { deferred } from '../test/deferred';
import * as auth from './auth';
import * as api from './api';
import { fetchSpotify, getSpotifyRetryAt, parseJson } from './http';

vi.mock('./auth', () => ({
  getAccessToken: vi.fn(),
  isSignedIn: vi.fn(),
  discardAccessToken: vi.fn()
}));

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers });

const callOf = (fetchMock: Mock, call = 0) => {
  const [url, init] = fetchMock.mock.calls[call] as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string> };
};

describe('spotify/api', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    localStorage.clear();
    history.replaceState(null, '', '/');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(auth.getAccessToken).mockResolvedValue('token-1');
    vi.mocked(auth.isSignedIn).mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('live requests', () => {
    it('reads the playback state with the bearer token', async () => {
      const state = { is_playing: true, item: { id: 't1' } };
      fetchMock.mockResolvedValue(json(state));
      expect(await api.getPlaybackState()).toEqual(state);
      const { url, init, headers } = callOf(fetchMock);
      expect(url).toBe('https://api.spotify.com/v1/me/player');
      expect(init.method).toBe('GET');
      expect(init.body).toBeUndefined();
      expect(headers).toEqual({ Authorization: 'Bearer token-1' });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('answers null when nothing is playing (204)', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
      expect(await api.getPlaybackState()).toBeNull();
    });

    it('answers null for a GET with an empty body', async () => {
      fetchMock.mockResolvedValue(new Response('', { status: 200 }));
      expect(await api.getPlaybackState()).toBeNull();
    });

    it('reads the queue, with defaults for a missing queue', async () => {
      fetchMock.mockResolvedValueOnce(json({ currently_playing: { id: 'a' }, queue: [{ id: 'b' }] }));
      expect(await api.getQueue()).toEqual({ currently_playing: { id: 'a' }, queue: [{ id: 'b' }] });
      expect(callOf(fetchMock).url).toBe('https://api.spotify.com/v1/me/player/queue');
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      expect(await api.getQueue()).toEqual({ currently_playing: null, queue: [] });
      fetchMock.mockResolvedValueOnce(json({}));
      expect(await api.getQueue()).toEqual({ currently_playing: null, queue: [] });
    });

    it('reads the devices, with a default for an empty reply', async () => {
      fetchMock.mockResolvedValueOnce(json({ devices: [{ id: 'd1', name: 'Kitchen' }] }));
      expect(await api.getDevices()).toEqual({ devices: [{ id: 'd1', name: 'Kitchen' }] });
      expect(callOf(fetchMock).url).toBe('https://api.spotify.com/v1/me/player/devices');
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      expect(await api.getDevices()).toEqual({ devices: [] });
    });

    it('transfers playback with a JSON body', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
      expect(await api.transferPlayback('device-1', true)).toEqual({ success: true });
      const { url, init, headers } = callOf(fetchMock);
      expect(url).toBe('https://api.spotify.com/v1/me/player');
      expect(init.method).toBe('PUT');
      expect(parseJson(init.body as string)).toEqual({ device_ids: ['device-1'], play: true });
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('does not start playing on transfer unless asked', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
      await api.transferPlayback('device-1');
      expect(parseJson(callOf(fetchMock).init.body as string)).toMatchObject({ play: false });
    });

    it.each([
      ['empty device', '', false],
      ['non-boolean play', 'd', 'yes']
    ])('rejects a transfer with %s before calling Spotify', async (_name, deviceId, playValue) => {
      await expect(api.transferPlayback(deviceId, playValue as boolean)).rejects.toMatchObject({
        status: 400,
        message: 'A deviceId and a boolean play value are required.'
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      ['play', () => api.play(), 'PUT', '/me/player/play'],
      ['pause', () => api.pause(), 'PUT', '/me/player/pause'],
      ['next', () => api.next(), 'POST', '/me/player/next'],
      ['previous', () => api.previous(), 'POST', '/me/player/previous'],
      ['seek', () => api.seek(30_000), 'PUT', '/me/player/seek?position_ms=30000'],
      ['setVolume', () => api.setVolume(55), 'PUT', '/me/player/volume?volume_percent=55']
    ])('%s calls the right endpoint', async (_name, run, method, path) => {
      fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
      expect(await run()).toEqual({ success: true });
      const { url, init, headers } = callOf(fetchMock);
      expect(url).toBe(`https://api.spotify.com/v1${path}`);
      expect(init.method).toBe(method);
      expect(init.body).toBeUndefined();
      expect(headers).toEqual({ Authorization: 'Bearer token-1' });
    });

    it('never parses the body of a command reply (200 with plain text)', async () => {
      fetchMock.mockResolvedValue(new Response('0b2a3c4d', { status: 200 }));
      expect(await api.next()).toEqual({ success: true });
    });

    it.each([
      ['seek negative', () => api.seek(-1), 'position_ms must be an integer between 0 and 9007199254740991.'],
      ['seek fraction', () => api.seek(1.5), 'position_ms must be an integer between 0 and 9007199254740991.'],
      ['seek text', () => api.seek('1' as never), 'position_ms must be an integer between 0 and 9007199254740991.'],
      ['volume high', () => api.setVolume(101), 'volume_percent must be an integer between 0 and 100.'],
      ['volume fraction', () => api.setVolume(0.5), 'volume_percent must be an integer between 0 and 100.']
    ])('rejects %s before calling Spotify', async (_name, run, message) => {
      await expect(run()).rejects.toMatchObject({ status: 400, message });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('accepts the volume limits', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
      await api.setVolume(0);
      await api.setVolume(100);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('signed out', () => {
    it('asks the person to sign in without calling Spotify', async () => {
      vi.mocked(auth.getAccessToken).mockResolvedValue(null);
      await expect(api.getPlaybackState()).rejects.toMatchObject({
        status: 401,
        message: 'Sign in to Spotify in Settings to control playback.'
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('passes on a token refresh failure', async () => {
      vi.mocked(auth.getAccessToken).mockRejectedValue(new api.SpotifyApiError('refresh failed', 502));
      await expect(api.play()).rejects.toMatchObject({ status: 502, message: 'refresh failed' });
    });
  });

  describe('401 retry', () => {
    it('refreshes the token and retries once', async () => {
      vi.mocked(auth.getAccessToken).mockResolvedValueOnce('old').mockResolvedValueOnce('new');
      fetchMock.mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json({ is_playing: false }));
      expect(await api.getPlaybackState()).toEqual({ is_playing: false });
      expect(auth.discardAccessToken).toHaveBeenCalledTimes(1);
      expect(callOf(fetchMock, 0).headers['Authorization']).toBe('Bearer old');
      expect(callOf(fetchMock, 1).headers['Authorization']).toBe('Bearer new');
    });

    it('retries a command with its body', async () => {
      fetchMock.mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(new Response(null, { status: 204 }));
      await api.transferPlayback('d1', true);
      expect(callOf(fetchMock, 1).init.body).toBe(callOf(fetchMock, 0).init.body);
    });

    it('gives up after one retry', async () => {
      fetchMock.mockResolvedValue(json({}, 401));
      await expect(api.getPlaybackState()).rejects.toMatchObject({
        status: 401,
        message: 'Spotify authorization failed. Sign in again in Settings.'
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not retry when there is no stored login', async () => {
      vi.mocked(auth.isSignedIn).mockReturnValue(false);
      fetchMock.mockResolvedValue(json({}, 401));
      await expect(api.getPlaybackState()).rejects.toMatchObject({ status: 401 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(auth.discardAccessToken).not.toHaveBeenCalled();
    });

    it('asks to sign in when the refresh after a 401 finds the login revoked', async () => {
      vi.mocked(auth.getAccessToken).mockResolvedValueOnce('old').mockResolvedValueOnce(null);
      fetchMock.mockResolvedValue(json({}, 401));
      await expect(api.getPlaybackState()).rejects.toMatchObject({
        message: 'Sign in to Spotify in Settings to control playback.'
      });
    });
  });

  describe('shared cooldown', () => {
    it.each([
      ['playback', api.getPlaybackState],
      ['queue', api.getQueue],
      ['devices', api.getDevices]
    ])('a %s rate limit blocks other reads and commands until exact expiry', async (_name, source) => {
      vi.useFakeTimers();
      fetchMock.mockResolvedValueOnce(json({}, 429, { 'Retry-After': '30' }));
      await expect(source()).rejects.toMatchObject({ status: 429, retryAfter: 30 });
      const tokenCalls = vi.mocked(auth.getAccessToken).mock.calls.length;
      const retryAt = getSpotifyRetryAt();
      await Promise.all(
        [
          api.getPlaybackState,
          api.getQueue,
          api.getDevices,
          api.next,
          api.pause,
          () => api.transferPlayback('speaker')
        ].map(request => expect(request()).rejects.toMatchObject({ status: 429, retryAt }))
      );
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(auth.getAccessToken).toHaveBeenCalledTimes(tokenCalls);
      await vi.advanceTimersByTimeAsync(29_999);
      await expect(api.next()).rejects.toMatchObject({ status: 429, retryAfter: 1, retryAt });
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledOnce();
      fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
      await api.getPlaybackState();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(callOf(fetchMock, 1).init.method).toBe('GET');
      await api.next();
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(callOf(fetchMock, 2).init.method).toBe('POST');
    });

    it('checks again after token acquisition if another request establishes a wait', async () => {
      const token = deferred<string>();
      vi.mocked(auth.getAccessToken).mockReturnValueOnce(token.promise);
      const playbackRead = api.getPlaybackState();
      fetchMock.mockResolvedValueOnce(json({}, 429, { 'Retry-After': '30' }));
      await fetchSpotify('https://api.spotify.com/v1/me/player/queue', {});
      token.resolve('token');
      await expect(playbackRead).rejects.toMatchObject({ status: 429, retryAfter: 30 });
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('does not reset a deadline while reading provider diagnostics', async () => {
      vi.useFakeTimers();
      const details = deferred<string>();
      const response = json({}, 403, { 'Retry-After': '30' });
      response.text = () => details.promise;
      fetchMock.mockResolvedValueOnce(response);
      const request = api.pause();
      await vi.waitFor(() => expect(getSpotifyRetryAt()).toBeGreaterThan(0));
      const retryAt = getSpotifyRetryAt();
      await vi.advanceTimersByTimeAsync(30_000);
      details.resolve(JSON.stringify({ error: { message: 'Provider diagnostic' } }));
      await expect(request).rejects.toMatchObject({
        status: 403,
        retryAt,
        message:
          'Spotify denied this action. Check Premium, app access, and device restrictions. Spotify says: Provider diagnostic'
      });
      expect(getSpotifyRetryAt()).toBe(0);
    });
  });

  describe('errors', () => {
    it.each([
      [404, 'No available Spotify device. Open Spotify on a speaker or phone, then select it here.'],
      [429, 'Spotify rate limit reached. Wait before trying again.'],
      [500, 'Spotify request failed (500).'],
      [503, 'Spotify request failed (503).']
    ])('describes a %i', async (status, message) => {
      fetchMock.mockResolvedValue(json({ error: { message: 'ignored' } }, status));
      await expect(api.getPlaybackState()).rejects.toMatchObject({ status, message, retryAfter: 0 });
    });

    it('reads Retry-After as seconds', async () => {
      fetchMock.mockResolvedValue(json({}, 429, { 'Retry-After': '7' }));
      const error = await api.pause().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(api.SpotifyApiError);
      expect(error).toMatchObject({ status: 429, retryAfter: 7 });
    });

    it('rounds a fractional Retry-After up', async () => {
      fetchMock.mockResolvedValueOnce(json({}, 429, { 'Retry-After': '1.2' }));
      await expect(api.pause()).rejects.toMatchObject({ retryAfter: 2 });
    });

    it.each(['soon', '-3'])('ignores invalid Retry-After %s', async header => {
      fetchMock.mockResolvedValueOnce(json({}, 429, { 'Retry-After': header }));
      await expect(api.pause()).rejects.toMatchObject({ retryAfter: 0 });
    });

    it('adds the reason Spotify gives for a 403', async () => {
      fetchMock.mockResolvedValue(json({ error: { message: 'Player command failed: Premium required' } }, 403));
      await expect(api.play()).rejects.toMatchObject({
        status: 403,
        message:
          'Spotify denied this action. Check Premium, app access, and device restrictions. Spotify says: Player command failed: Premium required'
      });
    });

    it.each([
      ['an unreadable body', new Response('forbidden', { status: 403 })],
      ['no message', json({ error: {} }, 403)],
      ['a non-text message', json({ error: { message: 5 } }, 403)],
      ['a null body', json(null, 403)]
    ])('has no suffix for a 403 with %s', async (_name, response) => {
      fetchMock.mockResolvedValue(response);
      await expect(api.play()).rejects.toMatchObject({
        message: 'Spotify denied this action. Check Premium, app access, and device restrictions.'
      });
    });

    it('does not read the reason of other errors', async () => {
      fetchMock.mockResolvedValue(json({ error: { message: 'secret' } }, 404));
      const error = (await api.play().catch((e: unknown) => e)) as Error;
      expect(error.message).not.toContain('secret');
    });

    it('reports a network failure', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
      await expect(api.getDevices()).rejects.toMatchObject({
        status: 502,
        message: 'Could not reach Spotify. Check the network connection.'
      });
    });

    it('reports a timeout', async () => {
      fetchMock.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
      await expect(api.getDevices()).rejects.toMatchObject({
        status: 504,
        message: 'Spotify did not answer in time. Try again.'
      });
    });

    it('defaults a SpotifyApiError to 502 with no retry delay', () => {
      const error = new api.SpotifyApiError('x');
      expect(error).toMatchObject({ message: 'x', status: 502, retryAfter: 0, name: 'SpotifyApiError' });
      expect(error).toBeInstanceOf(Error);
    });
  });
});
