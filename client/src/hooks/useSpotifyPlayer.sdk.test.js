import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { defined } from '../test/defined.js';
import { useSpotifyPlayer } from './useSpotifyPlayer.js';

const api = vi.hoisted(() => ({ requestJSON: vi.fn(), postJSON: vi.fn() }));
const sdk = vi.hoisted(() => ({ loadSpotifySDK: vi.fn() }));
vi.mock('../utils/api.js', () => api);
vi.mock('../utils/spotifySdk.js', () => sdk);

/** @param {{ connectResult?: boolean }} [options] */
function makeSdk({ connectResult = true } = {}) {
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

const browserSession = {
  '/api/info': { demoMode: false, spotifyConfigured: true, playbackMode: 'browser' },
  '/api/token': { authenticated: true, token: 'tok' },
  '/api/spotify/current': { is_playing: false }
};

/** @param {Record<string, unknown>} table */
function route(table) {
  api.requestJSON.mockImplementation((/** @type {string} */ url) => {
    const entry = table[url];
    if (entry instanceof Error) return Promise.reject(entry);
    if (entry === undefined) return Promise.reject(new Error(`unexpected ${url}`));
    return Promise.resolve(entry);
  });
}

beforeEach(() => {
  api.requestJSON.mockReset();
  api.postJSON.mockReset();
  sdk.loadSpotifySDK.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('useSpotifyPlayer browser playback', () => {
  async function connect() {
    const fake = makeSdk();
    sdk.loadSpotifySDK.mockResolvedValue({ Player: fake.Player });
    route(browserSession);
    const hook = renderHook(() => useSpotifyPlayer());
    await waitFor(() => expect(fake.players).toHaveLength(1));
    const player = defined(fake.players[0]);
    await waitFor(() => expect(player.connect).toHaveBeenCalled());
    return { ...hook, player };
  }

  it('registers a Web Playback device and exposes its id', async () => {
    const { result, player } = await connect();
    expect(player.options.name).toBe('THE MAX MIX');
    act(() => defined(player.listeners['ready'])({ device_id: 'web-1' }));
    expect(result.current.browserDeviceId).toBe('web-1');
  });

  it('supplies the access token and reports an expired login', async () => {
    const { result, player } = await connect();
    const cb = vi.fn();
    player.options.getOAuthToken(cb);
    await waitFor(() => expect(cb).toHaveBeenCalledWith('tok'));

    route({ ...browserSession, '/api/token': { authenticated: true } });
    player.options.getOAuthToken(cb);
    await waitFor(() => expect(result.current.error).toMatch(/login expired/i));
  });

  it('reports token fetch failures', async () => {
    const { result, player } = await connect();
    route({ ...browserSession, '/api/token': new Error('token down') });
    player.options.getOAuthToken(vi.fn());
    await waitFor(() => expect(result.current.error).toBe('token down'));
  });

  it('clears the device and warns when the tablet player disconnects', async () => {
    const { result, player } = await connect();
    act(() => defined(player.listeners['ready'])({ device_id: 'web-1' }));
    act(() => defined(player.listeners['not_ready'])());
    expect(result.current.browserDeviceId).toBeNull();
    expect(result.current.error).toMatch(/tablet player disconnected/i);
  });

  it.each(['initialization_error', 'authentication_error', 'account_error', 'playback_error'])(
    'surfaces %s from the SDK',
    async event => {
      const { result, player } = await connect();
      act(() => defined(player.listeners[event])({ message: 'Premium required.' }));
      expect(result.current.error).toMatch(/Browser playback: Premium required\./);
    }
  );

  it('disconnects the player on unmount', async () => {
    const { unmount, player } = await connect();
    unmount();
    expect(player.disconnect).toHaveBeenCalled();
  });

  it('reports a failed connect and SDK load errors', async () => {
    const fake = makeSdk({ connectResult: false });
    sdk.loadSpotifySDK.mockResolvedValue({ Player: fake.Player });
    route(browserSession);
    const first = renderHook(() => useSpotifyPlayer());
    await waitFor(() => expect(first.result.current.error).toMatch(/Could not connect the tablet player/));
    first.unmount();

    sdk.loadSpotifySDK.mockRejectedValue(new Error('SDK blocked'));
    const second = renderHook(() => useSpotifyPlayer());
    await waitFor(() => expect(second.result.current.error).toBe('SDK blocked'));
  });

  it('does not load the SDK in remote playback mode', async () => {
    route({ ...browserSession, '/api/info': { demoMode: false, playbackMode: 'remote' } });
    const { result } = renderHook(() => useSpotifyPlayer());
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    expect(sdk.loadSpotifySDK).not.toHaveBeenCalled();
  });
});

describe('useSpotifyPlayer polling', () => {
  it('backs off exponentially after failures and honours Retry-After', async () => {
    vi.useFakeTimers();
    const infoCalls = () => api.requestJSON.mock.calls.filter(([url]) => url === '/api/info').length;
    const rateLimited = Object.assign(new Error('Too many requests'), { retryAfter: 45 });
    api.requestJSON
      .mockRejectedValueOnce(new Error('blip'))
      .mockRejectedValueOnce(rateLimited)
      .mockResolvedValue({ demoMode: true });
    renderHook(() => useSpotifyPlayer());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(infoCalls()).toBe(1);
    // first failure: 8s delay (4s * 2^1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7999);
    });
    expect(infoCalls()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(infoCalls()).toBe(2);
    // second failure: max(16s, retryAfter 45s)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(44999);
    });
    expect(infoCalls()).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(infoCalls()).toBe(3);
  });

  it('clears the error once a poll succeeds and keeps polling every 4s', async () => {
    vi.useFakeTimers();
    api.requestJSON.mockRejectedValueOnce(new Error('blip'));
    api.requestJSON.mockImplementation((/** @type {string} */ url) =>
      Promise.resolve(url === '/api/info' ? { demoMode: true } : { device: { id: 'd' } })
    );
    const { result } = renderHook(() => useSpotifyPlayer());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.error).toBe('blip');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(result.current.error).toBeNull();
    const calls = api.requestJSON.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(api.requestJSON.mock.calls.length).toBeGreaterThan(calls);
  });

  it('stops polling after unmount', async () => {
    vi.useFakeTimers();
    api.requestJSON.mockImplementation((/** @type {string} */ url) =>
      Promise.resolve(url === '/api/info' ? { demoMode: true } : { device: { id: 'd' } })
    );
    const { unmount } = renderHook(() => useSpotifyPlayer());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    unmount();
    const calls = api.requestJSON.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30000);
    expect(api.requestJSON.mock.calls).toHaveLength(calls);
  });

  it('shows an auth_error from the login redirect', () => {
    api.requestJSON.mockReturnValue(new Promise(() => {}));
    window.history.pushState({}, '', '/?auth_error=Spotify%20denied');
    const { result } = renderHook(() => useSpotifyPlayer());
    window.history.pushState({}, '', '/');
    expect(result.current.error).toBe('Spotify denied');
  });
});
