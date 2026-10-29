import type { SpotifySdk } from '../types';

/** `window` as the Web Playback SDK script extends it. */
const sdkWindow = window as Window & { Spotify?: SpotifySdk; onSpotifyWebPlaybackSDKReady?: () => void };
let sdkPromise: Promise<SpotifySdk> | null = null;

export function loadSpotifySDK(): Promise<SpotifySdk> {
  const loaded = sdkWindow.Spotify;
  if (loaded) return Promise.resolve(loaded);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<SpotifySdk>((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = setTimeout(() => fail(new Error('Spotify SDK timed out. Check the internet connection.')), 20_000);
    const fail = (error: Error) => {
      clearTimeout(timeout);
      script.remove();
      sdkPromise = null;
      reject(error);
    };
    sdkWindow.onSpotifyWebPlaybackSDKReady = () => {
      clearTimeout(timeout);
      const sdk = sdkWindow.Spotify;
      if (sdk) resolve(sdk);
    };
    script.onerror = () => fail(new Error('Could not load the Spotify SDK. Check the internet connection.'));
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    document.head.append(script);
  });
  return sdkPromise;
}
