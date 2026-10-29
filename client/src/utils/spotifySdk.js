/** @typedef {import('../types.js').SpotifySdk} SpotifySdk */

/** `window` as the Web Playback SDK script extends it. */
const sdkWindow = /** @type {Window & { Spotify?: SpotifySdk, onSpotifyWebPlaybackSDKReady?: () => void }} */ (window);
/** @type {Promise<SpotifySdk> | null} */
let sdkPromise = null;

export function loadSpotifySDK() {
  const loaded = sdkWindow.Spotify;
  if (loaded) return Promise.resolve(loaded);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = setTimeout(() => fail(new Error('Spotify SDK timed out. Check the internet connection.')), 20000);
    /** @param {Error} error */
    const fail = error => {
      clearTimeout(timeout);
      script.remove();
      sdkPromise = null;
      reject(error);
    };
    sdkWindow.onSpotifyWebPlaybackSDKReady = () => {
      clearTimeout(timeout);
      resolve(/** @type {SpotifySdk} */ (sdkWindow.Spotify));
    };
    script.onerror = () => fail(new Error('Could not load the Spotify SDK. Check the internet connection.'));
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    document.head.appendChild(script);
  });
  return sdkPromise;
}
