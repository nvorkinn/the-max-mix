import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defined } from '../test/defined';

const win = window as Window & { Spotify?: unknown; onSpotifyWebPlaybackSDKReady?: () => void }; // Spotify globals are not part of the Window type

describe('loadSpotifySDK', () => {
  let loadSpotifySDK: typeof import('./spotifySdk').loadSpotifySDK;

  beforeEach(async () => {
    vi.resetModules();
    delete win.Spotify;
    delete win.onSpotifyWebPlaybackSDKReady;
    document.head.replaceChildren();
    ({ loadSpotifySDK } = await import('./spotifySdk'));
  });
  afterEach(() => vi.useRealTimers());

  it('resolves immediately when the SDK is already present', async () => {
    win.Spotify = { Player: vi.fn() };
    await expect(loadSpotifySDK()).resolves.toBe(win.Spotify);
    expect(document.head.querySelector('script')).toBeNull();
  });

  it('injects one script and resolves when the ready callback fires', async () => {
    const first = loadSpotifySDK();
    const second = loadSpotifySDK();
    expect(second).toBe(first);
    expect(document.head.querySelectorAll('script')).toHaveLength(1);
    expect(defined(document.head.querySelector('script')).src).toBe('https://sdk.scdn.co/spotify-player.js');
    win.Spotify = { ok: true };
    defined(win.onSpotifyWebPlaybackSDKReady)();
    await expect(first).resolves.toEqual({ ok: true });
  });

  it('rejects, removes the script and allows a retry on load error', async () => {
    const promise = loadSpotifySDK();
    defined(defined(document.head.querySelector('script')).onerror)(new Event('error'));
    await expect(promise).rejects.toThrow(/Could not load the Spotify SDK/);
    expect(document.head.querySelector('script')).toBeNull();
    loadSpotifySDK().catch(() => {});
    expect(document.head.querySelectorAll('script')).toHaveLength(1);
  });

  it('rejects after 20 seconds without the ready callback', async () => {
    vi.useFakeTimers();
    const promise = loadSpotifySDK();
    await Promise.all([expect(promise).rejects.toThrow(/timed out/), vi.advanceTimersByTimeAsync(20000)]);
  });
});
