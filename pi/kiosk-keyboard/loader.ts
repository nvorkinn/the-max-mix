// The content script Chromium runs on Spotify's sign-in pages. A content script cannot be a module, so this one only
// loads keyboard.js (a web-accessible file of the extension) as a module and starts it. Both run in the extension's
// isolated world, out of the page's reach.
declare const chrome: { runtime: { getURL: (path: string) => string } };

// A content script is a classic script, so it cannot await at the top level.
// eslint-disable-next-line unicorn/prefer-top-level-await -- see above
void import(chrome.runtime.getURL('keyboard.js')).then((keyboard: typeof import('./keyboard.ts')) => {
  keyboard.start(document);
});
