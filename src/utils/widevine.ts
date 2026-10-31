// The Web Playback SDK needs Widevine (encrypted media). When its player fails to start, this asks the browser directly
// so the error can say why, instead of only "Failed to initialize player".

const KEY_SYSTEM = 'com.widevine.alpha';
// What Spotify's player asks for: encrypted audio in an MP4 container.
const CONFIG: MediaKeySystemConfiguration[] = [
  {
    initDataTypes: ['cenc'],
    audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }]
  }
];

/** Why Widevine cannot play here, or null when it can. */
export async function widevineProblem(): Promise<string | null> {
  if (!window.isSecureContext) return 'Widevine needs a secure (https) page.';
  if (typeof navigator.requestMediaKeySystemAccess !== 'function') {
    return 'This browser has no encrypted media (EME) support, which Widevine needs.';
  }
  try {
    const access = await navigator.requestMediaKeySystemAccess(KEY_SYSTEM, CONFIG);
    await access.createMediaKeys();
    return null;
  } catch (error) {
    // EME rejects with a DOMException, which is not always an Error (jsdom's is not).
    const message = typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : '';
    const reason = message ? ` (${message})` : '';
    return `Widevine is not available in this browser${reason}. On the Pi, check that the libwidevinecdm0 package is installed and Chromium was restarted after it updated.`;
  }
}
