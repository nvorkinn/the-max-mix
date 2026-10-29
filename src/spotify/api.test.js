import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as auth from './auth.js';
import * as api from './api.js';
import { parseJson } from './http.js';
import { setDemoMode } from './settings.js';

vi.mock('./auth.js', () => ({
  getAccessToken: vi.fn(),
  isSignedIn: vi.fn(),
  discardAccessToken: vi.fn()
}));

/** @param {unknown} body @param {number} [status] @param {Record<string, string>} [headers] */
const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers });

/** @param {ReturnType<typeof vi.fn>} fetchMock @param {number} [call] */
const callOf = (fetchMock, call = 0) => {
  const [url, init] = /** @type {[string, RequestInit]} */ (fetchMock.mock.calls[call]);
  return { url, init, headers: /** @type {Record<string, string>} */ (init.headers) };
};

/** @typedef {import('../types.js').Track} Track */

describe('spotify/api', () => {
  /** @type {ReturnType<typeof vi.fn>} */
  let fetchMock;

  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/');
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
      expect(parseJson(/** @type {string} */ (init.body))).toEqual({ device_ids: ['device-1'], play: true });
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('does not start playing on transfer unless asked', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
      await api.transferPlayback('device-1');
      expect(parseJson(/** @type {string} */ (callOf(fetchMock).init.body))).toMatchObject({ play: false });
    });

    it.each([
      ['empty device', '', false],
      ['non-boolean play', 'd', 'yes']
    ])('rejects a transfer with %s before calling Spotify', async (_name, deviceId, playValue) => {
      await expect(api.transferPlayback(deviceId, /** @type {boolean} */ (playValue))).rejects.toMatchObject({
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
      [
        'seek text',
        () => api.seek(/** @type {never} */ ('1')),
        'position_ms must be an integer between 0 and 9007199254740991.'
      ],
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
      const error = await api.pause().catch((/** @type {unknown} */ e) => e);
      expect(error).toBeInstanceOf(api.SpotifyApiError);
      expect(error).toMatchObject({ status: 429, retryAfter: 7 });
    });

    it('rounds a fractional Retry-After up and ignores nonsense', async () => {
      fetchMock.mockResolvedValueOnce(json({}, 429, { 'Retry-After': '1.2' }));
      await expect(api.pause()).rejects.toMatchObject({ retryAfter: 2 });
      fetchMock.mockResolvedValueOnce(json({}, 429, { 'Retry-After': 'soon' }));
      await expect(api.pause()).rejects.toMatchObject({ retryAfter: 0 });
      fetchMock.mockResolvedValueOnce(json({}, 429, { 'Retry-After': '-3' }));
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
      const error = /** @type {Error} */ (await api.play().catch((/** @type {unknown} */ e) => e));
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

  describe('demo mode', () => {
    beforeEach(() => {
      setDemoMode(true);
      vi.resetModules();
    });

    /** A fresh demo player for each test. */
    const freshApi = async () => import('./api.js');
    const ALL_QUEUED = ['demo-queue-1', 'demo-queue-2', 'demo-queue-3', 'demo-queue-4'];
    /** @param {typeof api} demo */
    const queueIds = async demo => {
      const { queue } = await demo.getQueue();
      return queue.map(track => track.id);
    };

    it('is switched on by the address too, and never uses the network or a token', async () => {
      setDemoMode(false);
      window.history.replaceState(null, '', '/?demo=true');
      const demo = await freshApi();
      await expect(demo.getPlaybackState()).resolves.toMatchObject({ item: { name: 'One More Time' } });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(auth.getAccessToken).not.toHaveBeenCalled();
    });

    it('answers the playback state, queue and devices', async () => {
      const demo = await freshApi();
      await expect(demo.getPlaybackState()).resolves.toMatchObject({
        is_playing: true,
        progress_ms: 45000,
        device: { id: 'demo-tablet', volume_percent: 80 }
      });
      await expect(demo.getQueue()).resolves.toMatchObject({ currently_playing: { id: 'demo-track-1' } });
      expect(await queueIds(demo)).toEqual(ALL_QUEUED);
      await expect(demo.getDevices()).resolves.toMatchObject({ devices: [{ id: 'demo-tablet' }] });
    });

    it('hands out copies', async () => {
      const demo = await freshApi();
      const state = await demo.getPlaybackState();
      if (state) state.is_playing = false;
      await expect(demo.getPlaybackState()).resolves.toMatchObject({ is_playing: true });
    });

    it('plays, pauses, seeks and sets the volume', async () => {
      const demo = await freshApi();
      await expect(demo.pause()).resolves.toEqual({ success: true });
      await expect(demo.getPlaybackState()).resolves.toMatchObject({ is_playing: false });
      await demo.play();
      await expect(demo.getPlaybackState()).resolves.toMatchObject({ is_playing: true });
      await demo.seek(1000);
      await expect(demo.getPlaybackState()).resolves.toMatchObject({ progress_ms: 1000 });
      await demo.seek(99_999_999);
      await expect(demo.getPlaybackState()).resolves.toMatchObject({ progress_ms: 320000 });
      await demo.setVolume(30);
      await expect(demo.getPlaybackState()).resolves.toMatchObject({ device: { volume_percent: 30 } });
    });

    it('validates seek and volume like the live calls do', async () => {
      const demo = await freshApi();
      await expect(demo.seek(-5)).rejects.toMatchObject({ status: 400 });
      await expect(demo.setVolume(500)).rejects.toMatchObject({ status: 400 });
    });

    it('moves through the queue with next and back with previous', async () => {
      const demo = await freshApi();
      await expect(demo.previous()).rejects.toMatchObject({
        status: 409,
        message: 'No previous demo track available.'
      });
      await demo.seek(5000);
      await demo.next();
      await expect(demo.getPlaybackState()).resolves.toMatchObject({ item: { id: 'demo-queue-1' }, progress_ms: 0 });
      expect(await queueIds(demo)).toEqual(ALL_QUEUED.slice(1));
      await demo.previous();
      await expect(demo.getPlaybackState()).resolves.toMatchObject({ item: { id: 'demo-track-1' } });
      expect(await queueIds(demo)).toEqual(ALL_QUEUED);
    });

    it('runs out of tracks to skip to', async () => {
      const demo = await freshApi();
      await demo.next();
      await demo.next();
      await demo.next();
      await demo.next();
      await expect(demo.next()).rejects.toMatchObject({ status: 409, message: 'No next demo track available.' });
    });

    it('transfers to the demo device only', async () => {
      const demo = await freshApi();
      await demo.pause();
      await expect(demo.transferPlayback('demo-tablet', true)).resolves.toEqual({ success: true });
      await expect(demo.getPlaybackState()).resolves.toMatchObject({ is_playing: true });
      await demo.transferPlayback('demo-tablet');
      await expect(demo.getPlaybackState()).resolves.toMatchObject({ is_playing: false });
      await expect(demo.transferPlayback('elsewhere', true)).rejects.toMatchObject({
        status: 404,
        message: 'Demo device not found.'
      });
    });

    it('reorders the queue', async () => {
      const demo = await freshApi();
      const { queue } = await demo.getQueue();
      const reversed = queue.toReversed();
      const result = await demo.reorderDemoQueue(reversed);
      expect(result.queue.map(track => track.id)).toEqual(ALL_QUEUED.toReversed());
      expect(await queueIds(demo)).toEqual(ALL_QUEUED.toReversed());
    });

    it('refuses a reorder that is not a permutation of the queue', async () => {
      const demo = await freshApi();
      const { queue } = await demo.getQueue();
      const [first, second, third] = /** @type {[Track, Track, Track]} */ (queue);
      const message = 'Reordering requires each existing demo track exactly once.';
      await expect(demo.reorderDemoQueue([first, second, third])).rejects.toMatchObject({ status: 400, message });
      await expect(demo.reorderDemoQueue([first, first, second, third])).rejects.toMatchObject({ status: 400 });
      await expect(demo.reorderDemoQueue([...queue.slice(0, 3), { id: 'unknown' }])).rejects.toMatchObject({
        status: 400
      });
      await expect(demo.reorderDemoQueue(/** @type {never} */ ('nope'))).rejects.toMatchObject({ status: 400 });
      await expect(demo.reorderDemoQueue(/** @type {never} */ ([null, null, null, null]))).rejects.toMatchObject({
        status: 400
      });
    });

    it('plays a queued track now', async () => {
      const demo = await freshApi();
      const result = await demo.playDemoTrackNow('demo-queue-3');
      expect(result.remainingQueue.map(track => track.id)).toEqual(['demo-queue-1', 'demo-queue-2', 'demo-queue-4']);
      await expect(demo.getPlaybackState()).resolves.toMatchObject({
        is_playing: true,
        progress_ms: 0,
        item: { id: 'demo-queue-3' }
      });
      await demo.previous();
      await expect(demo.getPlaybackState()).resolves.toMatchObject({ item: { id: 'demo-track-1' } });
    });

    it('refuses to play an unknown track now', async () => {
      const demo = await freshApi();
      await expect(demo.playDemoTrackNow('nope')).rejects.toMatchObject({
        status: 404,
        message: 'Demo track not found.'
      });
    });
  });

  describe('live mode refuses demo-only actions', () => {
    const message =
      'Spotify does not expose live queue reordering or non-destructive play-now. Manage the queue in Spotify.';

    it('answers 409 for reorder and play-now', async () => {
      await expect(api.reorderDemoQueue([])).rejects.toMatchObject({ status: 409, message });
      await expect(api.playDemoTrackNow('x')).rejects.toMatchObject({ status: 409, message });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
