import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { defined } from '../test/defined';
import { resetSpotifyMocks } from '../test/spotifyMocks';
import { useSpotifyPlayer } from './useSpotifyPlayer';

const mocks = await vi.hoisted(async () => {
  const { createSpotifyMocks } = await import('../test/spotifyMocks');
  return createSpotifyMocks();
});
const sdk = vi.hoisted(() => ({ loadSpotifySDK: vi.fn() }));
vi.mock('../spotify/api', () => mocks.api);
vi.mock('../spotify/auth', () => mocks.auth);
vi.mock('../spotify/settings', () => mocks.settings);
vi.mock('../utils/spotifySdk', () => sdk);

/** @param {{ connectResult?: boolean, currentState?: unknown }} [options] */
function makeSdk({ connectResult = true, currentState = null } = {}) {
  /** @type {Player[]} */
  const players = [];
  class Player {
    /** @param {{ name: string, getOAuthToken: (callback: (token: string) => void) => void }} options */
    constructor(options) {
      this.options = options;
      /** @type {Record<string, (payload?: unknown) => void>} */
      this.listeners = {};
      this.disconnect = vi.fn();
      this.connect = vi.fn(() => Promise.resolve(connectResult));
      this.getCurrentState = vi.fn(() => Promise.resolve(currentState));
      this.togglePlay = vi.fn(() => Promise.resolve());
      this.nextTrack = vi.fn(() => Promise.resolve());
      this.previousTrack = vi.fn(() => Promise.resolve());
      this.seek = vi.fn(() => Promise.resolve());
      this.setVolume = vi.fn(() => Promise.resolve());
      this.activateElement = vi.fn(() => Promise.resolve());
      players.push(this);
    }
    /**
     * @param {string} event
     * @param {(payload?: unknown) => void} fn
     */
    addListener(event, fn) {
      this.listeners[event] = fn;
    }
  }
  return { Player, players };
}

/**
 * An SDK state event.
 * @param {string} id
 * @param {{ paused?: boolean, position?: number, next?: string[] }} [options]
 */
const sdkState = (id, { paused = false, position = 0, next = ['n1'] } = {}) => ({
  paused,
  position,
  duration: 200_000,
  track_window: {
    current_track: { id, name: `Song ${id}`, duration_ms: 200_000 },
    next_tracks: next.map(nextId => ({ id: nextId }))
  }
});

const webState = (/** @type {string} */ deviceId, isPlaying = true) => ({
  is_playing: isPlaying,
  progress_ms: 1000,
  item: { id: 't1', name: 'Song t1', duration_ms: 200_000 },
  device: { id: deviceId, name: 'Somewhere' }
});

beforeEach(() => {
  resetSpotifyMocks(mocks);
  sdk.loadSpotifySDK.mockReset();
  mocks.api.getPlaybackState.mockResolvedValue(webState('web-1'));
});
afterEach(() => vi.useRealTimers());

/** @param {{ currentState?: unknown }} [options] */
async function connect(options) {
  const fake = makeSdk(options);
  sdk.loadSpotifySDK.mockResolvedValue({ Player: fake.Player });
  const hook = renderHook(() => useSpotifyPlayer());
  await waitFor(() => expect(fake.players).toHaveLength(1));
  const player = defined(fake.players[0]);
  await waitFor(() => expect(player.connect).toHaveBeenCalled());
  /** @param {string} event @param {unknown} [payload] */
  const emit = (event, payload) => act(() => defined(player.listeners[event])(payload));
  return { ...hook, player, emit };
}

/**
 * Connects and announces the device, as the SDK does once it is registered.
 * @param {{ currentState?: unknown }} [options]
 */
async function ready(options) {
  const connected = await connect(options);
  connected.emit('ready', { device_id: 'web-1' });
  await act(async () => {});
  return connected;
}

const playbackCalls = () => mocks.api.getPlaybackState.mock.calls.length;

describe('useSpotifyPlayer browser playback', () => {
  it('registers a Web Playback device and exposes its id', async () => {
    const { result, player, emit } = await connect();
    expect(player.options.name).toBe('THE MAX MIX');
    emit('ready', { device_id: 'web-1' });
    expect(result.current.browserDeviceId).toBe('web-1');
  });

  it('supplies the access token and reports an expired login', async () => {
    const { result, player } = await connect();
    const callback = vi.fn();
    player.options.getOAuthToken(callback);
    await waitFor(() => expect(callback).toHaveBeenCalledWith('tok'));

    mocks.auth.getAccessToken.mockResolvedValue(null);
    player.options.getOAuthToken(callback);
    await waitFor(() => expect(result.current.error).toMatch(/login expired/i));
  });

  it('reports token failures', async () => {
    const { result, player } = await connect();
    mocks.auth.getAccessToken.mockRejectedValue(new Error('token down'));
    player.options.getOAuthToken(vi.fn());
    await waitFor(() => expect(result.current.error).toBe('token down'));
  });

  it('clears the device and warns when the tablet player disconnects', async () => {
    const { result, emit } = await connect();
    emit('ready', { device_id: 'web-1' });
    emit('not_ready');
    expect(result.current.browserDeviceId).toBeNull();
    expect(result.current.error).toMatch(/tablet player disconnected/i);
  });

  it.each(['initialization_error', 'authentication_error', 'account_error', 'playback_error'])(
    'surfaces %s from the SDK',
    async event => {
      const { result, emit } = await connect();
      emit(event, { message: 'Premium required.' });
      expect(result.current.error).toMatch(/Browser playback: Premium required\./);
    }
  );

  it('explains an autoplay failure and clears the message once music plays', async () => {
    const { result, emit } = await ready();
    emit('autoplay_failed');
    expect(result.current.error).toMatch(/blocked autoplay.*tap play/i);
    emit('player_state_changed', sdkState('t1'));
    expect(result.current.error).toBeNull();
  });

  it('disconnects the player on unmount', async () => {
    const { unmount, player } = await connect();
    unmount();
    expect(player.disconnect).toHaveBeenCalled();
  });

  it('reports a failed connect and SDK load errors', async () => {
    const fake = makeSdk({ connectResult: false });
    sdk.loadSpotifySDK.mockResolvedValue({ Player: fake.Player });
    const first = renderHook(() => useSpotifyPlayer());
    await waitFor(() => expect(first.result.current.error).toMatch(/Could not connect the tablet player/));
    first.unmount();

    sdk.loadSpotifySDK.mockRejectedValue(new Error('SDK blocked'));
    const second = renderHook(() => useSpotifyPlayer());
    await waitFor(() => expect(second.result.current.error).toBe('SDK blocked'));
  });

  it('does not load the SDK in remote playback mode, in demo mode or when signed out', async () => {
    mocks.settings.getPlaybackMode.mockReturnValue('remote');
    const remote = renderHook(() => useSpotifyPlayer());
    await waitFor(() => expect(remote.result.current.isReady).toBe(true));
    remote.unmount();

    mocks.settings.getPlaybackMode.mockReturnValue('browser');
    mocks.settings.isDemoMode.mockReturnValue(true);
    renderHook(() => useSpotifyPlayer()).unmount();

    mocks.settings.isDemoMode.mockReturnValue(false);
    mocks.auth.isSignedIn.mockReturnValue(false);
    renderHook(() => useSpotifyPlayer()).unmount();
    expect(sdk.loadSpotifySDK).not.toHaveBeenCalled();
  });
});

describe('useSpotifyPlayer is driven by SDK events', () => {
  it('reads playback and the queue hint when the player is ready, and seeds from the current state', async () => {
    const { result } = await ready({ currentState: sdkState('t1', { position: 5000 }) });
    expect(playbackCalls()).toBeGreaterThanOrEqual(2);
    expect(mocks.api.getPlaybackState).toHaveBeenCalled();
    expect(result.current.playbackState?.item?.id).toBe('t1');
    expect(result.current.sdkActive).toBe(true);
    expect(result.current.queueVersion).toBeGreaterThan(0);
  });

  it('shows a change at once from the SDK state and keeps it through a stale read', async () => {
    const { result, emit } = await ready();
    emit('player_state_changed', sdkState('t1', { paused: true, position: 4200 }));
    expect(result.current.playbackState?.is_playing).toBe(false);
    expect(result.current.playbackState?.progress_ms).toBe(4200);
    expect(result.current.playbackState?.item?.name).toBe('Song t1');
    // The Web API still says "playing" for a moment after; the button must not flip back.
    await act(async () => {
      await result.current.refreshPlayback();
    });
    expect(result.current.playbackState?.is_playing).toBe(false);
  });

  it('fetches playback only when the track changes', async () => {
    const { emit } = await ready();
    emit('player_state_changed', sdkState('t1'));
    await act(async () => {});
    const before = playbackCalls();
    emit('player_state_changed', sdkState('t1', { position: 3000 }));
    await act(async () => {});
    expect(playbackCalls()).toBe(before);
    emit('player_state_changed', sdkState('t2'));
    await waitFor(() => expect(playbackCalls()).toBeGreaterThan(before));
  });

  it('signals a queue change only when next_tracks changes', async () => {
    const { result, emit } = await ready();
    emit('player_state_changed', sdkState('t1', { next: ['a', 'b'] }));
    const first = result.current.queueVersion;
    emit('player_state_changed', sdkState('t1', { next: ['a', 'b'], position: 9000 }));
    expect(result.current.queueVersion).toBe(first);
    emit('player_state_changed', sdkState('t1', { next: ['b'] }));
    expect(result.current.queueVersion).toBe(first + 1);
  });

  it('does not poll while the SDK player is active, apart from a slow safety net', async () => {
    vi.useFakeTimers();
    const fake = makeSdk();
    sdk.loadSpotifySDK.mockResolvedValue({ Player: fake.Player });
    renderHook(() => useSpotifyPlayer());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const player = defined(fake.players[0]);
    act(() => defined(player.listeners['ready'])({ device_id: 'web-1' }));
    act(() => defined(player.listeners['player_state_changed'])(sdkState('t1')));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    const settled = playbackCalls();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(25_000);
    });
    expect(playbackCalls()).toBe(settled);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(playbackCalls()).toBeGreaterThan(settled);
  });

  it('moves the progress bar locally between events without any request', async () => {
    vi.useFakeTimers();
    const fake = makeSdk();
    sdk.loadSpotifySDK.mockResolvedValue({ Player: fake.Player });
    const { result } = renderHook(() => useSpotifyPlayer());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const player = defined(fake.players[0]);
    act(() => defined(player.listeners['ready'])({ device_id: 'web-1' }));
    act(() => defined(player.listeners['player_state_changed'])(sdkState('t1', { position: 10_000 })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    const calls = playbackCalls();
    const start = defined(result.current.playbackState?.progress_ms);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(defined(result.current.playbackState?.progress_ms) - start).toBeGreaterThanOrEqual(4900);
    expect(playbackCalls()).toBe(calls);

    // A paused player does not advance.
    act(() => defined(player.listeners['player_state_changed'])(sdkState('t1', { paused: true, position: 20_000 })));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(result.current.playbackState?.progress_ms).toBe(20_000);
  });

  it('polls every 4 seconds again once another device takes over', async () => {
    vi.useFakeTimers();
    const fake = makeSdk();
    sdk.loadSpotifySDK.mockResolvedValue({ Player: fake.Player });
    renderHook(() => useSpotifyPlayer());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const player = defined(fake.players[0]);
    act(() => defined(player.listeners['ready'])({ device_id: 'web-1' }));
    act(() => defined(player.listeners['player_state_changed'])(sdkState('t1')));
    // The SDK reports no state once another device is the active one.
    act(() => defined(player.listeners['player_state_changed'])(null));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    const calls = playbackCalls();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(playbackCalls() - calls).toBeGreaterThanOrEqual(2);
  });
});

describe('useSpotifyPlayer drives its own SDK player', () => {
  /** @param {boolean} active whether this page's player is the active device */
  async function setup(active) {
    const connected = await ready();
    if (active) connected.emit('player_state_changed', sdkState('t1'));
    return connected;
  }

  it('plays and pauses through the SDK while this page is the active player', async () => {
    const { result, player } = await setup(true);
    await act(async () => {
      expect(await result.current.togglePlay()).toBe(true);
    });
    expect(player.activateElement).toHaveBeenCalled();
    expect(player.togglePlay).toHaveBeenCalledTimes(1);
    expect(mocks.api.pause).not.toHaveBeenCalled();
  });

  it('sends next, previous, seek and volume through the SDK too', async () => {
    const { result, player } = await setup(true);
    await act(async () => {
      await result.current.nextTrack();
      await result.current.previousTrack();
      await result.current.seek(1234.6);
      await result.current.setVolume(0.4);
    });
    expect(player.nextTrack).toHaveBeenCalled();
    expect(player.previousTrack).toHaveBeenCalled();
    expect(player.seek).toHaveBeenCalledWith(1235);
    expect(player.setVolume).toHaveBeenCalledWith(0.4);
    expect(mocks.api.next).not.toHaveBeenCalled();
    expect(mocks.api.setVolume).not.toHaveBeenCalled();
  });

  it('Pause goes to the active device through the Web API when another device is playing', async () => {
    mocks.api.getPlaybackState.mockResolvedValue(webState('phone'));
    const { result, player } = await setup(false);
    await act(async () => {
      await result.current.togglePlay();
    });
    expect(mocks.api.pause).toHaveBeenCalledTimes(1);
    expect(player.togglePlay).not.toHaveBeenCalled();
  });

  it('Play from a paused, inactive page transfers once, then uses the SDK', async () => {
    mocks.api.getPlaybackState.mockResolvedValue(webState('phone', false));
    const { result, player } = await setup(false);
    await act(async () => {
      expect(await result.current.togglePlay()).toBe(true);
    });
    expect(mocks.api.transferPlayback).toHaveBeenCalledTimes(1);
    expect(mocks.api.transferPlayback).toHaveBeenCalledWith('web-1', true);
    expect(result.current.sdkActive).toBe(true);

    // The device is marked active, so the next press is an SDK command, not another transfer.
    await act(async () => {
      await result.current.togglePlay();
    });
    expect(mocks.api.transferPlayback).toHaveBeenCalledTimes(1);
    expect(player.togglePlay).toHaveBeenCalledTimes(1);
  });

  it('reports a failed first-Play transfer and puts the button back', async () => {
    mocks.api.getPlaybackState.mockResolvedValue(webState('phone', false));
    mocks.api.transferPlayback.mockRejectedValue(new Error('No premium'));
    const { result } = await setup(false);
    await act(async () => {
      expect(await result.current.togglePlay()).toBe(false);
    });
    expect(result.current.error).toBe('No premium');
    expect(result.current.playbackState?.is_playing).toBe(false);
  });

  it('keeps using the Web API for a device picked under Speakers', async () => {
    const { result, player } = await setup(true);
    await act(async () => {
      await result.current.transferPlayback('sonos-1');
    });
    expect(mocks.api.transferPlayback).toHaveBeenCalledWith('sonos-1', false);
    await act(async () => {
      await result.current.togglePlay();
      await result.current.nextTrack();
    });
    expect(player.togglePlay).not.toHaveBeenCalled();
    expect(mocks.api.pause).toHaveBeenCalledTimes(1);
    expect(mocks.api.next).toHaveBeenCalledTimes(1);
    // Picking this page again hands control back to the SDK.
    await act(async () => {
      await result.current.transferPlayback('web-1');
    });
    await act(async () => {
      await result.current.togglePlay();
    });
    expect(player.togglePlay).toHaveBeenCalledTimes(1);
  });

  it('reports an SDK command failure and puts the button back', async () => {
    const { result, player } = await setup(true);
    await act(async () => {
      await result.current.refreshPlayback();
    });
    player.togglePlay.mockRejectedValue(new Error('Player not ready'));
    await act(async () => {
      expect(await result.current.togglePlay()).toBe(false);
    });
    expect(result.current.error).toBe('Player not ready');
    expect(result.current.playbackState?.is_playing).toBe(true);
  });
});

describe('useSpotifyPlayer keeps the Play button usable', () => {
  const playingWithRestrictions = {
    ...webState('web-1', true),
    actions: { disallows: { resuming: true, skipping_prev: true } }
  };

  it('drops the stale resuming restriction when an SDK event pauses, and keeps the others', async () => {
    mocks.api.getPlaybackState.mockResolvedValue(playingWithRestrictions);
    const { result, emit } = await ready();
    await waitFor(() => expect(result.current.playbackState?.actions?.disallows?.resuming).toBe(true));
    emit('player_state_changed', sdkState('t1', { paused: true }));
    expect(result.current.playbackState?.is_playing).toBe(false);
    expect(result.current.playbackState?.actions?.disallows).toEqual({ skipping_prev: true });
  });

  it('drops the stale restriction on a press and while a stale read is held', async () => {
    mocks.api.getPlaybackState.mockResolvedValue(playingWithRestrictions);
    const { result, emit } = await ready();
    emit('player_state_changed', sdkState('t1'));
    await act(async () => {
      await result.current.togglePlay();
    });
    expect(result.current.playbackState?.actions?.disallows?.resuming).toBeUndefined();
    await act(async () => {
      await result.current.refreshPlayback();
    });
    expect(result.current.playbackState?.is_playing).toBe(false);
    expect(result.current.playbackState?.actions?.disallows?.resuming).toBeUndefined();
  });

  it('shows an SDK event even before any playback has been read', async () => {
    mocks.api.getPlaybackState.mockResolvedValue(null);
    const { result, emit } = await ready();
    emit('player_state_changed', sdkState('t1', { paused: true }));
    expect(result.current.playbackState?.is_playing).toBe(false);
  });
});

describe('useSpotifyPlayer recovers after the page was in the background', () => {
  it('gives up on an SDK command that never answers, so the next press works', async () => {
    const { result, player, emit } = await ready();
    emit('player_state_changed', sdkState('t1'));
    vi.useFakeTimers();
    player.togglePlay.mockReturnValueOnce(new Promise(() => {}));
    /** @type {Promise<boolean>} */
    let pressed = Promise.resolve(true);
    act(() => {
      pressed = result.current.togglePlay();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(await pressed).toBe(false);
    expect(result.current.error).toMatch(/did not answer/i);
    await act(async () => {
      expect(await result.current.togglePlay()).toBe(true);
    });
    expect(player.togglePlay).toHaveBeenCalledTimes(2);
  });

  it('reads playback and the queue again, and the player state, when the tab comes back', async () => {
    const { result, player } = await ready({ currentState: sdkState('t9', { paused: true }) });
    await waitFor(() => expect(player.getCurrentState).toHaveBeenCalled());
    await act(async () => {});
    const reads = playbackCalls();
    const queue = result.current.queueVersion;
    player.getCurrentState.mockClear();
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(playbackCalls()).toBe(reads + 1));
    expect(result.current.queueVersion).toBe(queue + 1);
    expect(player.getCurrentState).toHaveBeenCalled();
    expect(player.connect).toHaveBeenCalledTimes(1);
  });

  it('connects a dropped player again when the page returns or the network is back', async () => {
    const { player, emit } = await ready();
    emit('not_ready');
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(player.connect).toHaveBeenCalledTimes(2);
  });

  it('does nothing while the page is hidden', async () => {
    const { player } = await ready();
    const reads = playbackCalls();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    visibility.mockRestore();
    await act(async () => {});
    expect(playbackCalls()).toBe(reads);
    expect(player.connect).toHaveBeenCalledTimes(1);
  });
});

describe('useSpotifyPlayer polling in remote mode', () => {
  beforeEach(() => {
    mocks.settings.getPlaybackMode.mockReturnValue('remote');
  });

  it('reads playback every 4 seconds and never touches the SDK', async () => {
    vi.useFakeTimers();
    renderHook(() => useSpotifyPlayer());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(playbackCalls()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3999);
    });
    expect(playbackCalls()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(playbackCalls()).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(playbackCalls()).toBe(4);
    expect(sdk.loadSpotifySDK).not.toHaveBeenCalled();
  });

  it('backs off exponentially after failures and honours Retry-After', async () => {
    vi.useFakeTimers();
    const rateLimited = Object.assign(new Error('Too many requests'), { retryAfter: 45 });
    mocks.api.getPlaybackState
      .mockRejectedValueOnce(new Error('blip'))
      .mockRejectedValueOnce(rateLimited)
      .mockResolvedValue(webState('d'));
    renderHook(() => useSpotifyPlayer());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(playbackCalls()).toBe(1);
    // first failure: 8s delay (4s * 2^1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7999);
    });
    expect(playbackCalls()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(playbackCalls()).toBe(2);
    // second failure: max(16s, retryAfter 45s)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(44_999);
    });
    expect(playbackCalls()).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(playbackCalls()).toBe(3);
  });

  it('clears the error once a poll succeeds', async () => {
    vi.useFakeTimers();
    mocks.api.getPlaybackState.mockRejectedValueOnce(new Error('blip')).mockResolvedValue(webState('d'));
    const { result } = renderHook(() => useSpotifyPlayer());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.error).toBe('blip');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(result.current.error).toBeNull();
  });

  it('stops polling after unmount', async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useSpotifyPlayer());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    unmount();
    const calls = playbackCalls();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(playbackCalls()).toBe(calls);
  });
});
