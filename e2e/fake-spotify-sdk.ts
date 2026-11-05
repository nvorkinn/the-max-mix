import type { Page } from '@playwright/test';

/** What the page's fake player records and does; see fakeSpotifySdk. */
interface FakeSdk {
  players: { emit: (event: string, payload?: unknown) => void }[];
  activated: number;
}
declare global {
  // A global of the page the tests look into: a `var` is what reaches globalThis.
  var __fakeSdk: FakeSdk | undefined;
}

// The Web Playback SDK script, replaced by a small player that connects, becomes a device and keeps a record of how it was
// used. It sends no sound and no state of its own: tests make it emit what the real one would (not_ready, autoplay_failed…).
const SCRIPT = `
(() => {
  const sdk = { players: [], activated: 0 };
  globalThis.__fakeSdk = sdk;
  class Player {
    constructor(options) {
      this.options = options;
      this.listeners = {};
      sdk.players.push(this);
    }
    addListener(event, listener) {
      (this.listeners[event] = this.listeners[event] || []).push(listener);
      return true;
    }
    removeListener() { return true; }
    emit(event, payload) { for (const listener of this.listeners[event] || []) listener(payload); }
    connect() {
      this.options.getOAuthToken(() => {});
      const deviceId = 'web-device-' + sdk.players.indexOf(this);
      setTimeout(() => this.emit('ready', { device_id: deviceId }), 0);
      return Promise.resolve(true);
    }
    disconnect() {}
    getCurrentState() { return Promise.resolve(null); }
    activateElement() { sdk.activated += 1; return Promise.resolve(); }
    setVolume() { return Promise.resolve(); }
    pause() { return Promise.resolve(); }
    resume() { return Promise.resolve(); }
    togglePlay() { return Promise.resolve(); }
    seek() { return Promise.resolve(); }
    nextTrack() { return Promise.resolve(); }
    previousTrack() { return Promise.resolve(); }
  }
  window.Spotify = { Player };
  if (window.onSpotifyWebPlaybackSDKReady) window.onSpotifyWebPlaybackSDKReady();
})();
`;

/**
 * Makes the page play in its own browser, as the tablet does: the Web Playback SDK is a fake that connects at once and
 * becomes the device `web-device-<n>` (n counts the players made, so a reconnect gets a new one). Call it after
 * fakeSpotify, which puts the page in remote mode.
 */
export async function fakeSpotifySdk(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('maxmix.playbackMode', 'browser');
  });
  await page.route('https://sdk.scdn.co/spotify-player.js', route =>
    route.fulfill({ contentType: 'application/javascript', body: SCRIPT })
  );
  return {
    /** Makes the newest fake player emit an SDK event, as Spotify's would. */
    emit: (event: string, payload?: unknown) =>
      page.evaluate(
        ([name, data]) => globalThis.__fakeSdk?.players.at(-1)?.emit(name as string, data),
        [event, payload]
      ),
    /** How many players the page has made (a reconnect makes another); none until the SDK script has loaded. */
    players: () => page.evaluate(() => globalThis.__fakeSdk?.players.length ?? 0),
    /** How many times the page asked the browser to allow audio. */
    activations: () => page.evaluate(() => globalThis.__fakeSdk?.activated ?? 0)
  };
}
