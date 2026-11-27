// The page a phone gets after it joins the kiosk's setup hotspot (hotspot.ts): the networks the kiosk saw, and a
// password box (alone at the top once a network is chosen, so the phone's keyboard cannot cover it), so the password
// is typed on the phone's own keyboard. The hotspot's DNS answers every name with the kiosk's address, so the phone's
// check for internet ends here, and its "sign in to Wi-Fi" page opens this one.
//
// It is the service's own HTTP server that answers: it also accepts connections on the hotspot's address (port 80 when
// the service may, so that check can reach it, and 8080 when not) while the hotspot is up. Everything that arrives
// that way is handed to `handlePortalRequest` and nothing else, so the kiosk's own requests (reboot, update, the
// speakers) stay on 127.0.0.1 and are not reachable from the hotspot, whose password anyone nearby may know.
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer as createListener } from 'node:net';
import type { Socket } from 'node:net';
import { LOCALES, preferredLanguage, say } from '../../shared/src/words.ts';
import type { Language, WordId } from '../../shared/src/words.ts';
import { parseConnectRequest } from './nmcli.ts';
import type { ConnectRequest, Network } from './nmcli.ts';

const PORTS = [80, 8080];
const MAX_BODY = 4096;

/** What the portal needs: the networks to offer, and what to do when the phone has chosen one. */
export interface PortalOptions {
  networks: () => Network[];
  /** Called after the phone has been answered: the hotspot goes away to join the network. */
  onJoin: (request: ConnectRequest) => void;
}

/** The extra listener on the hotspot's address. */
export interface Portal {
  port: number;
  close: () => Promise<void>;
}

/** Whether a connection came in on this machine's own address: the kiosk's own page and the app, not the hotspot. */
export function isLoopback(address: string | undefined): boolean {
  // eslint-disable-next-line sonarjs/no-hardcoded-ip -- the loopback address, as Node reports it for a dual-stack socket
  return address === '::1' || address === '::ffff:127.0.0.1' || address?.startsWith('127.') === true;
}

// SSIDs are text anyone can broadcast, so the page only ever sets them as text, never as HTML. The words are the
// catalogue's (words.ts), which has no markup in it.
/** The page in `language`: the phone's, as it asks in Accept-Language. */
export function portalHtml(language: Language): string {
  const w = (id: WordId): string => say(id, language);
  // A string for the script, quoted as the script quotes its own.
  const js = (id: WordId, args: Readonly<Record<string, string>> = {}): string => {
    const escaped = say(id, language, args).replaceAll('\\', '\\\\').replaceAll("'", "\\'");
    return `'${escaped}'`;
  };
  return `<!doctype html>
<html lang="${LOCALES[language]}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>THE MAX MIX Wi-Fi</title>
    <style>
      body { margin: 0; font: 17px/1.4 system-ui, sans-serif; background: #16191a; color: #f0f0ea; }
      main { max-width: 480px; margin: 0 auto; padding: 20px 16px 40px; }
      p { color: #b9bdb4; margin: 4px 0 16px; }
      button, input { font: inherit; border-radius: 10px; border: 0; padding: 14px; }
      button { width: 100%; text-align: left; background: #262b2c; color: inherit; margin-bottom: 8px; }
      button.primary { background: #6f9a52; color: #101310; text-align: center; font-weight: 600; }
      #back { text-align: center; }
      #done { display: flex; flex-direction: column; align-items: center; gap: 20px; padding-top: 40px; text-align: center; }
      #done[hidden] { display: none; }
      #done p { color: inherit; font-size: 20px; }
      .spinner { width: 44px; height: 44px; border: 4px solid #262b2c; border-top-color: #6f9a52; border-radius: 50%; animation: spin 0.9s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
      input { width: 100%; box-sizing: border-box; background: #262b2c; color: inherit; margin-bottom: 12px; }
      #error { color: #ff8a80; }
      [hidden] { display: none; }
    </style>
  </head>
  <body>
    <main>
      <p id="error" role="alert" hidden></p>
      <form id="form" hidden autocomplete="off">
        <input id="name" placeholder="${w('portal.networkName')}" hidden />
        <input id="password" type="password" placeholder="${w('portal.password')}" />
        <button class="primary" type="submit" id="connect">${w('portal.connect')}</button>
        <button type="button" id="back">${w('portal.back')}</button>
      </form>
      <section id="list"></section>
      <button type="button" id="other">${w('portal.otherNetwork')}</button>
      <section id="done" hidden>
        <div class="spinner" aria-hidden="true"></div>
        <p id="joining" role="status"></p>
      </section>
    </main>
    <script>
      const $ = id => document.getElementById(id);
      let chosen = { ssid: '', security: 'psk', hidden: false };
      const fail = message => { $('error').textContent = message; $('error').hidden = message === ''; };
      const choose = (network, hidden) => {
        chosen = { ssid: network.ssid, security: network.security, hidden };
        $('password').placeholder = hidden ? ${js('portal.password')} : ${js('portal.passwordFor', { ssid: '%s' })}.replace('%s', network.ssid);
        $('name').hidden = !hidden;
        $('password').hidden = network.security === 'open' && !hidden;
        // An open network has no password box to name it, so its button does.
        $('connect').textContent = $('password').hidden
          ? ${js('portal.connectTo', { ssid: '%s' })}.replace('%s', network.ssid)
          : ${js('portal.connect')};
        // The chosen network's box takes the top of the page, where the phone's keyboard cannot cover it.
        for (const id of ['list', 'other']) $(id).hidden = true;
        $('form').hidden = false;
        window.scrollTo(0, 0);
        (hidden ? $('name') : $('password')).focus();
      };
      $('back').addEventListener('click', () => {
        fail('');
        $('form').hidden = true;
        $('name').value = '';
        $('password').value = '';
        for (const id of ['list', 'other']) $(id).hidden = false;
      });
      fetch('/networks.json').then(r => r.json()).then(body => {
        for (const network of body.networks) {
          if (network.security === 'unsupported') continue;
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = network.ssid + (network.security === 'psk' ? '  🔒' : '');
          button.addEventListener('click', () => choose(network, false));
          $('list').append(button);
        }
      }).catch(() => fail(${js('portal.loadFailed')}));
      $('other').addEventListener('click', () => choose({ ssid: '', security: 'psk' }, true));
      $('form').addEventListener('submit', async event => {
        event.preventDefault();
        fail('');
        const hidden = chosen.hidden;
        const ssid = hidden ? $('name').value.trim() : chosen.ssid;
        const password = $('password').value;
        if (ssid === '') return;
        const security = hidden || password !== '' ? 'psk' : chosen.security;
        try {
          const response = await fetch('/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ssid, password, hidden, security: password === '' ? 'open' : security })
          });
          if (!response.ok) throw new Error('refused');
          // Only the result is left on the page.
          for (const id of ['list', 'other', 'form']) $(id).hidden = true;
          $('joining').textContent = ${js('portal.joining', { ssid: '%s' })}.replace('%s', ssid);
          $('done').hidden = false;
          // The phone has nothing more to do here. A browser closes only a tab that nothing else was opened in (the
          // camera's link, the sign-in sheet), so the words above stay for one that will not.
          setTimeout(() => window.close(), 1000);
        } catch {
          fail(${js('portal.refused')});
        }
      });
    </script>
  </body>
</html>
`;
}

/** The page in English. */
export const PORTAL_HTML = portalHtml('en');

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw new RangeError('The request is too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const send = (response: ServerResponse, status: number, type: string, body = ''): void => {
  response
    .writeHead(status, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      // Only this page's own script and styles, and requests to itself.
      'Content-Security-Policy':
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'",
      'X-Content-Type-Options': 'nosniff'
    })
    .end(body);
};

/** Answers a request that came in over the hotspot: the page, the networks, and the network the phone chose. */
export async function handlePortalRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: PortalOptions
): Promise<void> {
  try {
    const path = (request.url ?? '/').split('?', 1)[0];
    if (path === '/connect' && request.method === 'POST') {
      const body = parseConnectRequest(JSON.parse(await readBody(request)) as unknown);
      if (!body) {
        send(response, 400, 'application/json', '{"ok":false}');
        return;
      }
      send(response, 200, 'application/json', '{"ok":true}');
      options.onJoin(body);
    } else if (path === '/networks.json' && request.method === 'GET') {
      send(response, 200, 'application/json', JSON.stringify({ networks: options.networks() }));
    } else if (request.method === 'GET' || request.method === 'HEAD') {
      // Every other address, for the phone's internet check too, gets the page: that is what opens it by itself.
      send(
        response,
        200,
        'text/html; charset=utf-8',
        request.method === 'HEAD' ? '' : portalHtml(preferredLanguage(request.headers['accept-language']))
      );
    } else {
      send(response, 405, 'text/plain', 'Not allowed');
    }
  } catch {
    send(response, 400, 'text/plain', 'Bad request');
  }
}

/** Answers a request that came in over the hotspot when no hotspot is up (it was just taken down). */
export function refusePortalRequest(response: ServerResponse): void {
  send(response, 404, 'text/plain', 'Not found');
}

function listen(listener: ReturnType<typeof createListener>, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(port, host, () => {
      listener.off('error', reject);
      resolve();
    });
  });
}

/**
 * Makes `server` (the service's own HTTP server) accept connections on the hotspot's address too, on port 80, or on
 * 8080 when the service may not use port 80. Requests that arrive this way are told apart by `isLoopback`.
 */
export async function listenForHotspot(
  server: Server,
  host: string,
  ports: readonly number[] = PORTS
): Promise<Portal> {
  const sockets = new Set<Socket>();
  let lastError: unknown;
  for (const port of ports) {
    const listener = createListener(socket => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      server.emit('connection', socket);
    });
    try {
      // The next port is only tried when this one could not be used.
      // eslint-disable-next-line no-await-in-loop
      await listen(listener, host, port);
      const address = listener.address();
      return {
        port: typeof address === 'object' && address ? address.port : port,
        close: () =>
          new Promise<void>(resolve => {
            listener.close(() => {
              resolve();
            });
            for (const socket of sockets) socket.destroy();
          })
      };
    } catch (error) {
      lastError = error;
      listener.close();
    }
  }
  throw new Error('The setup page could not be served.', { cause: lastError });
}
