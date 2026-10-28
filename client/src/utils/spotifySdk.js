/** @type {any} */
const sdkWindow = window;
let sdkPromise;

export function loadSpotifySDK() {
  if (sdkWindow.Spotify) return Promise.resolve(sdkWindow.Spotify);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = setTimeout(() => fail(new Error('Spotify SDK timed out. Check the internet connection.')), 20000);
    const fail = (error) => {
      clearTimeout(timeout);
      script.remove();
      sdkPromise = null;
      reject(error);
    };
    sdkWindow.onSpotifyWebPlaybackSDKReady = () => {
      clearTimeout(timeout);
      resolve(sdkWindow.Spotify);
    };
    script.onerror = () => fail(new Error('Could not load the Spotify SDK. Check the internet connection.'));
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    document.head.appendChild(script);
  });
  return sdkPromise;
}
