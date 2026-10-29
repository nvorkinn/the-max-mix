import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSpotifyPlayer } from './useSpotifyPlayer.js';

const api = vi.hoisted(() => ({ requestJSON: vi.fn(), postJSON: vi.fn() }));
vi.mock('../utils/api.js', () => api);
vi.mock('../utils/spotifySdk.js', () => ({ loadSpotifySDK: vi.fn() }));

/** @param {Record<string, unknown>} table */
function route(table) {
  api.requestJSON.mockImplementation((/** @type {string} */ url) => {
    const entry = table[url];
    if (entry instanceof Error) return Promise.reject(entry);
    if (entry === undefined) return Promise.reject(new Error(`unexpected ${url}`));
    return Promise.resolve(entry);
  });
}

describe('useSpotifyPlayer', () => {
  beforeEach(() => {
    api.requestJSON.mockReset();
    api.postJSON.mockReset();
  });

  it('starts in a loading state', () => {
    api.requestJSON.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useSpotifyPlayer());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('loads playback in demo mode without asking for a token', async () => {
    route({
      '/api/info': { demoMode: true, spotifyConfigured: false },
      '/api/spotify/current': { is_playing: true, device: { id: 'd' } }
    });
    const { result } = renderHook(() => useSpotifyPlayer());
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.isDemoMode).toBe(true);
    expect(api.requestJSON).not.toHaveBeenCalledWith('/api/token');
  });

  it('does not fetch playback when unauthenticated', async () => {
    route({
      '/api/info': { demoMode: false, spotifyConfigured: true },
      '/api/token': { authenticated: false }
    });
    const { result } = renderHook(() => useSpotifyPlayer());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(api.requestJSON).toHaveBeenCalledWith('/api/token'));
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.isConfigured).toBe(true);
    expect(api.requestJSON).not.toHaveBeenCalledWith('/api/spotify/current');
  });

  it('surfaces connection errors and clears auth on 401', async () => {
    const error = Object.assign(new Error('Not logged in'), { status: 401 });
    route({ '/api/info': error });
    const { result } = renderHook(() => useSpotifyPlayer());
    await waitFor(() => expect(result.current.error).toBe('Not logged in'));
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.playbackState).toBeNull();
  });

  it('togglePlay pauses when playing and refreshes playback', async () => {
    route({
      '/api/info': { demoMode: true },
      '/api/spotify/current': { is_playing: true, device: { id: 'd' } }
    });
    api.postJSON.mockResolvedValue({});
    const { result } = renderHook(() => useSpotifyPlayer());
    await waitFor(() => expect(result.current.isReady).toBe(true));

    let ok;
    await act(async () => {
      ok = await result.current.togglePlay();
    });
    expect(ok).toBe(true);
    expect(api.postJSON).toHaveBeenCalledWith('/api/spotify/pause', undefined);
  });

  it('togglePlay flips the button at once and keeps it there while Spotify still reports the old state', async () => {
    route({
      '/api/info': { demoMode: true },
      '/api/spotify/current': { is_playing: true, device: { id: 'd' } }
    });
    let finishPost = () => {};
    api.postJSON.mockImplementation(() => new Promise(resolve => (finishPost = () => resolve({}))));
    const { result } = renderHook(() => useSpotifyPlayer());
    await waitFor(() => expect(result.current.isReady).toBe(true));

    /** @type {Promise<boolean> | undefined} */
    let pending;
    act(() => {
      pending = result.current.togglePlay();
    });
    // Flipped before the server has answered.
    expect(result.current.playbackState?.is_playing).toBe(false);
    // A second press while the first is in flight sends nothing.
    let second;
    await act(async () => {
      second = await result.current.togglePlay();
    });
    expect(second).toBe(false);
    expect(api.postJSON).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishPost();
      await pending;
    });
    // The read after the command still says "playing" (Spotify lags); the button keeps "paused".
    expect(result.current.playbackState?.is_playing).toBe(false);
    await act(async () => {
      await result.current.refreshPlayback();
    });
    expect(result.current.playbackState?.is_playing).toBe(false);

    // The next press plays again, as the button shows.
    api.postJSON.mockResolvedValue({});
    await act(async () => {
      await result.current.togglePlay();
    });
    expect(api.postJSON).toHaveBeenLastCalledWith('/api/spotify/play', undefined);
  });

  it('togglePlay goes back to what Spotify says once it agrees or the hold runs out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      let playing = true;
      api.requestJSON.mockImplementation((/** @type {string} */ url) =>
        Promise.resolve(url === '/api/info' ? { demoMode: true } : { is_playing: playing, device: { id: 'd' } })
      );
      api.postJSON.mockResolvedValue({});
      const { result } = renderHook(() => useSpotifyPlayer());
      await waitFor(() => expect(result.current.isReady).toBe(true));
      await act(async () => {
        await result.current.togglePlay();
      });
      expect(result.current.playbackState?.is_playing).toBe(false);

      // Spotify catches up, then something else starts playback: the button follows the server again.
      playing = false;
      await act(async () => {
        await result.current.refreshPlayback();
      });
      playing = true;
      await act(async () => {
        await result.current.refreshPlayback();
      });
      expect(result.current.playbackState?.is_playing).toBe(true);

      // A hold that nobody ever confirms ends after a few seconds.
      await act(async () => {
        await result.current.togglePlay();
      });
      vi.setSystemTime(Date.now() + 6000);
      await act(async () => {
        await result.current.refreshPlayback();
      });
      expect(result.current.playbackState?.is_playing).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a failed play or pause puts the button back and reports the error', async () => {
    route({
      '/api/info': { demoMode: true },
      '/api/spotify/current': { is_playing: true, device: { id: 'd' } }
    });
    api.postJSON.mockRejectedValue(new Error('Spotify denied this action.'));
    const { result } = renderHook(() => useSpotifyPlayer());
    await waitFor(() => expect(result.current.isReady).toBe(true));

    let ok;
    await act(async () => {
      ok = await result.current.togglePlay();
    });
    expect(ok).toBe(false);
    expect(result.current.playbackState?.is_playing).toBe(true);
    expect(result.current.error).toBe('Spotify denied this action.');
    // And a failed command does not keep later presses blocked.
    api.postJSON.mockResolvedValue({});
    await act(async () => {
      ok = await result.current.togglePlay();
    });
    expect(ok).toBe(true);
  });

  it('records command failures as an action error that can be cleared', async () => {
    route({
      '/api/info': { demoMode: true },
      '/api/spotify/current': { is_playing: false, device: { id: 'd' } }
    });
    api.postJSON.mockRejectedValue(new Error('No active device'));
    const { result } = renderHook(() => useSpotifyPlayer());
    await waitFor(() => expect(result.current.isReady).toBe(true));

    let ok;
    await act(async () => {
      ok = await result.current.nextTrack();
    });
    expect(ok).toBe(false);
    expect(result.current.error).toBe('No active device');

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it('rounds seek and volume values', async () => {
    route({
      '/api/info': { demoMode: true },
      '/api/spotify/current': { device: { id: 'd' } }
    });
    api.postJSON.mockResolvedValue({});
    const { result } = renderHook(() => useSpotifyPlayer());
    await waitFor(() => expect(result.current.isReady).toBe(true));

    await act(async () => {
      await result.current.seek(1234.6);
    });
    expect(api.postJSON).toHaveBeenCalledWith('/api/spotify/seek', { position_ms: 1235 });
    await act(async () => {
      await result.current.setVolume(0.456);
    });
    expect(api.postJSON).toHaveBeenCalledWith('/api/spotify/volume', { volume_percent: 46 });
  });

  it('transferPlayback rethrows after recording the error', async () => {
    route({
      '/api/info': { demoMode: true },
      '/api/spotify/current': { device: { id: 'd' } }
    });
    api.postJSON.mockRejectedValue(new Error('Transfer failed'));
    const { result } = renderHook(() => useSpotifyPlayer());
    await waitFor(() => expect(result.current.isReady).toBe(true));

    await act(async () => {
      await expect(result.current.transferPlayback('abc')).rejects.toThrow('Transfer failed');
    });
    expect(api.postJSON).toHaveBeenCalledWith('/api/transfer', { deviceId: 'abc', play: false });
    expect(result.current.error).toBe('Transfer failed');
  });
});
