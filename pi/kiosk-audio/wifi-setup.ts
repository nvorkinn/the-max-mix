// Serves the Wi-Fi setup page, which has to work with no internet, so it cannot live in the web app:
//   GET /wifi-setup              the page (below)
//   GET /wifi-setup/page.js      wifi-page.ts, its types stripped by Node (no build step, no npm package)
//   GET /wifi-setup/keyboard.js  the sign-in keyboard (pi/kiosk-keyboard), as the Ansible role built it
import { readFile } from 'node:fs/promises';
// Experimental, but in every Node 24, and nothing else strips types without an npm package.
// eslint-disable-next-line n/no-unsupported-features/node-builtins -- see above
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

const KEYBOARD_JS = '/opt/the-max-mix/kiosk-keyboard/extension/keyboard.js';
const PAGE_TS = path.join(import.meta.dirname, 'wifi-page.ts');

export const PAGE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Wi-Fi setup</title>
    <style>
      :root { color-scheme: dark; --bg: #101210; --card: #181c18; --row: #202520; --text: #e6ebe6; --muted: #8a948a;
        --accent: #3a8a55; --on: #5fbf7f; --off: #3a423a; --error: #e57373; }
      * { box-sizing: border-box; }
      html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text);
        font: 22px/1.3 system-ui, sans-serif; cursor: none; user-select: none; -webkit-user-select: none; }
      main { height: 100%; padding: 16px; display: flex; }
      section { flex: 1; display: flex; flex-direction: column; gap: 12px; padding: 20px; border-radius: 16px;
        background: var(--card); min-height: 0; }
      [hidden] { display: none !important; }
      header { display: flex; align-items: center; gap: 12px; }
      h1 { flex: 1; margin: 0; font-size: 30px; font-weight: 500; white-space: nowrap; overflow: hidden;
        text-overflow: ellipsis; }
      button { font: inherit; color: var(--text); background: var(--row); border: 0; border-radius: 10px;
        padding: 10px 20px; min-height: 56px; }
      button:active { background: #2a322a; }
      button:disabled { color: var(--muted); }
      .primary { background: var(--accent); }
      p { margin: 0; }
      #status:empty { display: none; }
      #error { color: var(--error); }
      #status { color: var(--muted); }
      ul { list-style: none; margin: 0; padding: 0; overflow-y: auto; display: grid; gap: 8px; }
      .network { width: 100%; display: flex; align-items: center; gap: 16px; text-align: left; }
      .ssid { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .note { color: var(--muted); }
      .bars { display: flex; align-items: flex-end; gap: 3px; height: 24px; }
      .bars i { width: 6px; background: var(--off); border-radius: 1px; }
      .bars i:nth-child(1) { height: 25%; } .bars i:nth-child(2) { height: 50%; }
      .bars i:nth-child(3) { height: 75%; } .bars i:nth-child(4) { height: 100%; }
      .bars i.on { background: var(--on); }
      form { display: grid; gap: 12px; }
      label { display: grid; gap: 6px; color: var(--muted); }
      .field { display: flex; gap: 8px; }
      input { flex: 1; font: inherit; color: var(--text); background: var(--bg); border: 2px solid var(--off);
        border-radius: 10px; padding: 10px 14px; min-width: 0; }
      input:focus { outline: none; border-color: var(--accent); }
      .steps { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; min-height: 0; }
      .steps figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 8px; min-height: 0; }
      .qr { flex: 1; min-height: 0; aspect-ratio: 1; }
      .qr svg { height: 100%; width: 100%; background: #fff; border-radius: 8px; }
      figcaption { font-size: 18px; text-align: center; color: var(--muted); }
      figcaption b { color: var(--text); font-weight: 600; word-break: break-all; }
      #busy { position: fixed; inset: 0; display: grid; place-items: center; background: rgb(16 18 16 / 94%);
        font-size: 28px; }
    </style>
  </head>
  <body>
    <main>
      <section id="list-view">
        <header>
          <h1>Choose a Wi-Fi network</h1>
          <button type="button" id="other">Other…</button>
          <button type="button" id="phone">From phone</button>
          <button type="button" id="hotspot">Hotspot</button>
          <button type="button" id="refresh">Refresh</button>
          <button type="button" id="cancel" hidden>Cancel</button>
        </header>
        <p id="error" role="alert" hidden></p>
        <p id="status"></p>
        <p id="phone-help" hidden></p>
        <ul id="networks"></ul>
      </section>
      <section id="hotspot-view" hidden>
        <header>
          <button type="button" id="hotspot-back">Back</button>
          <h1>Set up from any phone</h1>
        </header>
        <div class="steps">
          <figure>
            <div class="qr" id="qr-wifi" role="img" aria-label="QR code that joins the hotspot"></div>
            <figcaption>1. Scan to join <b id="hotspot-name"></b><br />Password: <b id="hotspot-password"></b></figcaption>
          </figure>
          <figure>
            <div class="qr" id="qr-url" role="img" aria-label="QR code that opens the setup page"></div>
            <figcaption>2. If the page does not open by itself, scan to open <b id="hotspot-url"></b></figcaption>
          </figure>
        </div>
        <p id="hotspot-status"></p>
      </section>
      <section id="join-view" hidden>
        <header>
          <button type="button" id="back">Back</button>
          <h1 id="join-title">Join</h1>
        </header>
        <form id="join-form" autocomplete="off">
          <label id="name-row">Network name<span class="field"><input id="name" type="text" spellcheck="false" /></span></label>
          <label>Password<span class="field"><input id="password" type="password" spellcheck="false" />
            <button type="button" id="show">Show</button></span></label>
          <button type="submit" id="connect" class="primary">Connect</button>
        </form>
      </section>
    </main>
    <div id="busy" role="status" hidden></div>
    <script type="module">
      import { main } from '/wifi-setup/page.js';
      void main();
    </script>
  </body>
</html>
`;

export interface Asset {
  type: string;
  body: string;
}

// The page script, stripped once.
const stripped = new Map<string, string>();

/** The page or one of its scripts for a GET of `url`, or null when the URL is not one of them. */
export async function wifiSetupAsset(url: string, keyboardFile = KEYBOARD_JS): Promise<Asset | null> {
  const pathname = new URL(url, 'http://localhost').pathname;
  switch (pathname) {
    case '/wifi-setup': {
      return { type: 'text/html; charset=utf-8', body: PAGE_HTML };
    }
    case '/wifi-setup/page.js': {
      const body = stripped.get(PAGE_TS) ?? stripTypeScriptTypes(await readFile(PAGE_TS, 'utf8'));
      stripped.set(PAGE_TS, body);
      return { type: 'text/javascript; charset=utf-8', body };
    }
    case '/wifi-setup/keyboard.js': {
      return { type: 'text/javascript; charset=utf-8', body: await readFile(keyboardFile, 'utf8') };
    }
    default: {
      return null;
    }
  }
}
