import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { resetSpotifyMocks } from '../test/spotifyMocks';
import { SpotifyApiError } from '../spotify/http';
import { useSpotifyPlayer } from './useSpotifyPlayer';

const mocks = await vi.hoisted(async () => {
  const { createSpotifyMocks } = await import('../test/spotifyMocks');
  return createSpotifyMocks();
});
vi.mock('../spotify/api', () => mocks.api);
vi.mock('../spotify/auth', () => mocks.auth);
vi.mock('../spotify/settings', () => mocks.settings);
vi.mock('../utils/spotifySdk', () => ({ loadSpotifySDK: vi.fn() }));

const playing = { is_playing: true, device: { id: 'd' } };

describe('useSpotifyPlayer', () => {
  beforeEach(() => {
    resetSpotifyMocks(mocks);
    // Demo mode: no SDK, no sign-in needed.
    mocks.settings.isDemoMode.mockReturnValue(true);
    mocks.auth.isSignedIn.mockReturnValue(false);
  });

  it('starts in a loading state', () => {
    mocks.api.getPlaybackState.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useSpotifyPlayer());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('loads playback in demo mode without needing a login', async () => {
    mocks.api.getPlaybackState.mockResolvedValue(playing);
    const { result } = renderHook(() => useSpotifyPlayer());
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.isDemoMode).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(mocks.auth.getAccessToken).not.toHaveBeenCalled();
  });

  it('reads the configuration from the settings and the stored login', async () => {
    mocks.settings.isDemoMode.mockReturnValue(false);
    mocks.auth.isSignedIn.mockReturnValue(true);
    mocks.settings.getPlaybackMode.mockReturnValue('remote');
    mocks.api.getPlaybackState.mockResolvedValue(playing);
    const { result } = renderHook(() => useSpotifyPlayer());
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.playbackMode).toBe('remote');
  });

  it('does not fetch playback when signed out', async () => {
    mocks.settings.isDemoMode.mockReturnValue(false);
    const { result } = renderHook(() => useSpotifyPlayer());
    await act(async () => {});
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isAuthenticated).toBe(false);
    expect(mocks.api.getPlaybackState).not.toHaveBeenCalled();
  });

  it('surfaces connection errors and signs out the view on a revoked login', async () => {
    mocks.settings.isDemoMode.mockReturnValue(false);
    mocks.auth.isSignedIn.mockReturnValueOnce(true).mockReturnValue(false);
    mocks.api.getPlaybackState.mockRejectedValue(new SpotifyApiError('Not logged in', 401));
    const { result } = renderHook(() => useSpotifyPlayer());
    await waitFor(() => expect(result.current.error).toBe('Not logged in'));
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.playbackState).toBeNull();
  });

  it('togglePlay pauses when playing and refreshes playback', async () => {
    mocks.api.getPlaybackState.mockResolvedValue(playing);
    const { result } = renderHook(() => useSpotifyPlayer());
    await waitFor(() => expect(result.current.isReady).toBe(true));

    let ok;
    await act(async () => {
      ok = await result.current.togglePlay();
    });
    expect(ok).toBe(true);
    expect(mocks.api.pause).toHaveBeenCalledTimes(1);
  });

  it('togglePlay flips the button at once and keeps it there while Spotify still reports the old state', async () => {
    mocks.api.getPlaybackState.mockResolvedValue(playing);
    let finishCommand = () => {};
    mocks.api.pause.mockImplementation(() => new Promise(resolve => (finishCommand = () => resolve(undefined))));
    const { result } = renderHook(() => useSpotifyPlayer());
    await waitFor(() => expect(result.current.isReady).toBe(true));

    let pending: Promise<boolean> | undefined;
    act(() => {
      pending = result.current.togglePlay();
    });
    // Flipped before Spotify has answered.
    expect(result.current.playbackState?.is_playing).toBe(false);
    // A second press while the first is in flight sends nothing.
    let second;
    await act(async () => {
      second = await result.current.togglePlay();
    });
    expect(second).toBe(false);
    expect(mocks.api.pause).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishCommand();
      await pending;
    });
    // The read after the command still says "playing" (Spotify lags); the button keeps "paused".
    expect(result.current.playbackState?.is_playing).toBe(false);
    await act(async () => {
      await result.current.refreshPlayback();
    });
    expect(result.current.playbackState?.is_playing).toBe(false);

    // The next press plays again, as the button shows.
    mocks.api.pause.mockResolvedValue(undefined);
    await act(async () => {
      await result.current.togglePlay();
    });
    expect(mocks.api.play).toHaveBeenCalledTimes(1);
  });

  it('togglePlay goes back to what Spotify says once it agrees or the hold runs out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      let isPlaying = true;
      mocks.api.getPlaybackState.mockImplementation(() =>
        Promise.resolve({ is_playing: isPlaying, device: { id: 'd' } })
      );
      const { result } = renderHook(() => useSpotifyPlayer());
      await waitFor(() => expect(result.current.isReady).toBe(true));
      await act(async () => {
        await result.current.togglePlay();
      });
      expect(result.current.playbackState?.is_playing).toBe(false);

      // Spotify catches up, then something else starts playback: the button follows Spotify again.
      isPlaying = false;
      await act(async () => {
        await result.current.refreshPlayback();
      });
      isPlaying = true;
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
    mocks.api.getPlaybackState.mockResolvedValue(playing);
    mocks.api.pause.mockRejectedValue(new Error('Spotify denied this action.'));
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
    mocks.api.pause.mockResolvedValue(undefined);
    await act(async () => {
      ok = await result.current.togglePlay();
    });
    expect(ok).toBe(true);
  });

  it('records command failures as an action error that can be cleared', async () => {
    mocks.api.getPlaybackState.mockResolvedValue({ is_playing: false, device: { id: 'd' } });
    mocks.api.next.mockRejectedValue(new Error('No active device'));
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

  it('sends previous, rounds seek and converts volume to a percentage', async () => {
    mocks.api.getPlaybackState.mockResolvedValue({ device: { id: 'd' } });
    const { result } = renderHook(() => useSpotifyPlayer());
    await waitFor(() => expect(result.current.isReady).toBe(true));

    await act(async () => {
      await result.current.previousTrack();
      await result.current.seek(1234.6);
      await result.current.setVolume(0.456);
    });
    expect(mocks.api.previous).toHaveBeenCalledTimes(1);
    expect(mocks.api.seek).toHaveBeenCalledWith(1235);
    expect(mocks.api.setVolume).toHaveBeenCalledWith(46);
  });

  it('transferPlayback rethrows after recording the error', async () => {
    mocks.api.getPlaybackState.mockResolvedValue({ device: { id: 'd' } });
    mocks.api.transferPlayback.mockRejectedValue(new Error('Transfer failed'));
    const { result } = renderHook(() => useSpotifyPlayer());
    await waitFor(() => expect(result.current.isReady).toBe(true));

    await act(async () => {
      await expect(result.current.transferPlayback('abc')).rejects.toThrow('Transfer failed');
    });
    expect(mocks.api.transferPlayback).toHaveBeenCalledWith('abc', false);
    expect(result.current.error).toBe('Transfer failed');
  });
});
