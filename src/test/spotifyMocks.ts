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
    reorderDemoQueue: vi.fn(),
    playDemoTrackNow: vi.fn()
  };
  const auth = {
    startSignIn: vi.fn(),
    completeSignIn: vi.fn(),
    isSignedIn: vi.fn(),
    getAccessToken: vi.fn(),
    signOut: vi.fn()
  };
  const settings = {
    getClientId: vi.fn(),
    setClientId: vi.fn(),
    getPlaybackMode: vi.fn(),
    setPlaybackMode: vi.fn(),
    isDemoMode: vi.fn(),
    setDemoMode: vi.fn(),
    getRedirectUri: vi.fn()
  };
  return { api, auth, settings };
}

/** Puts every mock back to a signed-in, browser-mode, non-demo default with a client ID. */
export function resetSpotifyMocks({ api, auth, settings }: ReturnType<typeof createSpotifyMocks>) {
  for (const group of [api, auth, settings]) for (const mock of Object.values(group)) mock.mockReset();
  auth.isSignedIn.mockReturnValue(true);
  auth.getAccessToken.mockResolvedValue('tok');
  settings.getClientId.mockReturnValue('client-id');
  settings.getPlaybackMode.mockReturnValue('browser');
  settings.isDemoMode.mockReturnValue(false);
  settings.getRedirectUri.mockReturnValue('http://127.0.0.1:3000/');
  api.transferPlayback.mockResolvedValue(undefined);
  for (const name of ['play', 'pause', 'next', 'previous', 'seek', 'setVolume'] as const) {
    api[name].mockResolvedValue(undefined);
  }
}
