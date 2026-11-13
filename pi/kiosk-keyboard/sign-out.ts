// The content script Chromium runs on the app's own pages (build.ts adds it for the kiosk's app origin). When the app
// signs out of Spotify it posts { type: 'maxmix:forget-sign-ins' } to its window; this passes that to background.ts,
// which clears what every other site keeps, and answers { type: 'maxmix:sign-ins-forgotten' } when it is done.
// A content script cannot be a module, so this file exports nothing.
declare const chrome: { runtime: { sendMessage: (message: unknown) => Promise<unknown> } };

window.addEventListener('message', (event: MessageEvent) => {
  const data: unknown = event.data;
  if (event.source !== window || event.origin !== location.origin) return;
  if (typeof data !== 'object' || data === null || !('type' in data) || data.type !== 'maxmix:forget-sign-ins') return;
  void chrome.runtime
    .sendMessage({ type: 'maxmix:forget-sign-ins' })
    .catch(() => undefined)
    .then(() => window.postMessage({ type: 'maxmix:sign-ins-forgotten' }, location.origin));
});
