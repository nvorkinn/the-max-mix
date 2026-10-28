import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const api = vi.hoisted(() => ({ requestJSON: vi.fn(), postJSON: vi.fn() }));
vi.mock('../utils/api.js', () => api);
vi.mock('../utils/spotifySdk.js', () => ({ loadSpotifySDK: vi.fn() }));

import { useSpotifyPlayer } from './useSpotifyPlayer.js';

function route(table) {
  api.requestJSON.mockImplementation(async (url) => {
    const entry = table[url];
    if (entry instanceof Error) throw entry;
    if (entry === undefined) throw new Error(`unexpected ${url}`);
    return entry;
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
    await act(async () => { ok = await result.current.togglePlay(); });
    expect(ok).toBe(true);
    expect(api.postJSON).toHaveBeenCalledWith('/api/spotify/pause', undefined);
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
    await act(async () => { ok = await result.current.nextTrack(); });
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

    await act(async () => { await result.current.seek(1234.6); });
    expect(api.postJSON).toHaveBeenCalledWith('/api/spotify/seek', { position_ms: 1235 });
    await act(async () => { await result.current.setVolume(0.456); });
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
