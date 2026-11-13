// The content script Chromium runs on the app's own pages (build.ts adds it for the kiosk's app origin). When the app
// signs out of Spotify it posts { type: 'maxmix:forget-sign-ins' } to its window; this passes that to background.ts,
// which clears what every other site keeps, and answers { type: 'maxmix:sign-ins-forgotten' } when it is done.
// A content script cannot be a module, so this file exports nothing.
declare const chrome: { runtime: { sendMessage: (message: unknown) => Promise<unknown> } };

async function forget(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: 'maxmix:forget-sign-ins' });
  } catch {
    // The extension could not clear them; the app is told it is done all the same, so it does not wait.
  }
  globalThis.postMessage({ type: 'maxmix:sign-ins-forgotten' }, location.origin);
}

globalThis.addEventListener('message', (event: MessageEvent) => {
  if (event.origin !== location.origin || (event.source as unknown) !== globalThis) return;
  const data: unknown = event.data;
  if (typeof data === 'object' && data !== null && 'type' in data && data.type === 'maxmix:forget-sign-ins') {
    void forget();
  }
});
