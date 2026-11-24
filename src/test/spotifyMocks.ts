import { vi } from 'vitest';

/**
 * Mock modules for `../spotify/*`, created with `vi.hoisted` and handed to `vi.mock` in each test file, so tests code
 * against the documented contract and never depend on the real network or sign-in code.
 */
export function createSpotifyMocks() {
  const api = {
    getPlaybackState: vi.fn(),
    getQueue: vi.fn(),
    getDevices: vi.fn(),
    transferPlayback: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    setShuffle: vi.fn(),
    setRepeat: vi.fn(),
    getRecentlyPlayed: vi.fn(),
    getPlaylists: vi.fn(),
    getLikedSongs: vi.fn(),
    playChoice: vi.fn()
  };
  const auth = {
    isSignedIn: vi.fn(),
    getAccessToken: vi.fn(),
    signOut: vi.fn()
  };
  const settings = {
    getPlaybackMode: vi.fn()
  };
  return { api, auth, settings };
}

/** Puts every mock back to a signed-in, browser-mode default with a client ID. */
export function resetSpotifyMocks({ api, auth, settings }: ReturnType<typeof createSpotifyMocks>) {
  for (const group of [api, auth, settings]) for (const mock of Object.values(group)) mock.mockReset();
  auth.isSignedIn.mockReturnValue(true);
  auth.getAccessToken.mockResolvedValue('tok');
  settings.getPlaybackMode.mockReturnValue('browser');
  api.transferPlayback.mockResolvedValue(undefined);
  const commands = [
    'play',
    'pause',
    'next',
    'previous',
    'seek',
    'setVolume',
    'setShuffle',
    'setRepeat',
    'playChoice'
  ] as const;
  for (const name of commands) {
    api[name].mockResolvedValue(undefined);
  }
}
