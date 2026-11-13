// The content script Chromium runs on every page that is not the app (the manifest's `matches`; build.ts leaves the
// app's own address out). The kiosk has no address bar and no back button, so a page outside the app (Spotify's
// sign-in, an error page of theirs, a help page a link led to) would otherwise be a dead end. This draws one button,
// in the top right corner, that goes back to the app. A content script cannot be a module, so this file has no exports.
{
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    button {
      position: fixed; inset: 12px 12px auto auto; z-index: 2147483647; min-height: 56px; padding: 0 22px; border: 0;
      border-radius: 28px; background: #1f1f1f; color: #fff; font: 500 20px/1 system-ui, sans-serif;
      box-shadow: 0 2px 10px rgb(0 0 0 / 50%); touch-action: manipulation; user-select: none;
      -webkit-user-select: none; cursor: default;
    }
    button:active { background: #555; }
  `;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '← Back to THE MAX MIX';
  // Chromium starts on the app (kiosk-session), so the first entry of the history is the app, with the address the
  // kiosk gave it, however many pages came since. On that first entry itself this reloads the page.
  button.addEventListener('click', () => {
    history.go(1 - history.length);
  });
  root.append(style, button);
  document.documentElement.append(host);
}
