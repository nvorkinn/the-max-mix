// @vitest-environment node
/* eslint-disable sonarjs/no-hardcoded-ip -- the hotspot's address and page are plain http on a private address, by design */
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exchange } from './fixtures.ts';
import {
  handlePortalRequest,
  isLoopback,
  listenForHotspot,
  PORTAL_HTML,
  refusePortalRequest
} from './hotspot-portal.ts';
import type { Portal } from './hotspot-portal.ts';
import type { ConnectRequest } from './nmcli.ts';

const NETWORKS = [
  { ssid: 'Home', signal: 80, bars: 4, security: 'psk' as const },
  { ssid: 'Cafe', signal: 50, bars: 2, security: 'open' as const }
];
const onJoin = vi.fn<(request: ConnectRequest) => void>();
const options = { networks: () => NETWORKS, onJoin };
const listeners: Portal[] = [];
const servers: Server[] = [];

afterEach(async () => {
  onJoin.mockReset();
  await Promise.all(listeners.splice(0).map(listener => listener.close()));
  for (const server of servers.splice(0)) server.close();
});

async function handle(method: string, url: string, body?: unknown) {
  const { request, response, sent } = exchange(method, url, { body });
  await handlePortalRequest(request, response, options);
  return sent;
}

/** A stand-in for the service's own HTTP server. */
const service = () => {
  const server = createServer((request, response) => {
    response.end(`from the service, ${request.socket.localAddress}`);
  });
  servers.push(server);
  return server;
};

describe('kiosk-audio/hotspot-portal', () => {
  it('tells this machine’s own connections from the hotspot’s', () => {
    for (const own of ['127.0.0.1', '127.0.0.2', '::1', '::ffff:127.0.0.1']) expect(isLoopback(own)).toBe(true);
    for (const other of ['10.42.0.1', '192.168.1.5', '::ffff:10.42.0.1', '', undefined]) {
      expect(isLoopback(other)).toBe(false);
    }
  });

  it('serves the page at every address, so the phone’s internet check opens it', async () => {
    const paths = ['/', '/hotspot-detect.html', '/generate_204', '/connecttest.txt?x=1'];
    const answers = await Promise.all(paths.map(path => handle('GET', path)));
    for (const sent of answers) {
      expect(sent.status).toBe(200);
      expect(sent.headers?.['Content-Type']).toContain('text/html');
      expect(sent.body).toBe(PORTAL_HTML);
    }
    expect((await handle('HEAD', '/')).body).toBe('');
  });

  it('only runs its own script and talks only to itself', async () => {
    const { headers } = await handle('GET', '/');
    expect(headers?.['Content-Security-Policy']).toContain("default-src 'none'");
    expect(headers?.['Content-Security-Policy']).toContain("connect-src 'self'");
    expect(headers?.['Cache-Control']).toBe('no-store');
  });

  it('never puts a network name into the page as HTML', () => {
    expect(PORTAL_HTML).not.toContain('innerHTML');
    expect(PORTAL_HTML).toContain('textContent');
  });

  it('lists the networks the kiosk saw', async () => {
    const sent = await handle('GET', '/networks.json');
    expect(JSON.parse(sent.body ?? '')).toEqual({ networks: NETWORKS });
  });

  it('accepts the network the phone chose, and then tells the kiosk', async () => {
    const chosen = { ssid: 'Home', password: 'placeholder-pass', hidden: false, security: 'psk' };
    const sent = await handle('POST', '/connect', chosen);
    expect(sent.status).toBe(200);
    expect(JSON.parse(sent.body ?? '')).toEqual({ ok: true });
    expect(onJoin).toHaveBeenCalledWith(chosen);
  });

  it('refuses a request that is not a network, and does not tell the kiosk', async () => {
    expect((await handle('POST', '/connect', { ssid: '', password: 'x', security: 'psk' })).status).toBe(400);
    expect((await handle('POST', '/connect', { ssid: 'Home', password: 'x', security: 'wep' })).status).toBe(400);
    expect((await handle('POST', '/connect', 'not json')).status).toBe(400);
    expect(
      (await handle('POST', '/connect', { ssid: 'Home', password: 'x'.repeat(5000), security: 'psk' })).status
    ).toBe(400);
    expect(onJoin).not.toHaveBeenCalled();
  });

  it('allows only reading, and posting a network', async () => {
    expect((await handle('PUT', '/anything')).status).toBe(405);
    expect((await handle('DELETE', '/connect')).status).toBe(405);
  });

  it('answers 404 when no hotspot is up', () => {
    const { response, sent } = exchange('GET', '/');
    refusePortalRequest(response);
    expect(sent.status).toBe(404);
  });

  describe('listening for the hotspot', () => {
    it('makes the service’s own server answer on another address', async () => {
      const listener = await listenForHotspot(service(), '127.0.0.1', [0]);
      listeners.push(listener);
      const response = await fetch(`http://127.0.0.1:${listener.port}/`);
      expect(await response.text()).toBe('from the service, 127.0.0.1');
    });

    it('falls back to the next port when one cannot be used, and fails when none can', async () => {
      const blocker = createServer();
      servers.push(blocker);
      await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', resolve));
      const taken = (blocker.address() as AddressInfo).port;

      const fallback = await listenForHotspot(service(), '127.0.0.1', [taken, 0]);
      listeners.push(fallback);
      expect(fallback.port).not.toBe(taken);
      expect((await fetch(`http://127.0.0.1:${fallback.port}/`)).status).toBe(200);
      await expect(listenForHotspot(service(), '127.0.0.1', [taken])).rejects.toThrow(
        'The setup page could not be served.'
      );
    });

    it('stops answering, and drops open connections, when it is closed', async () => {
      const listener = await listenForHotspot(service(), '127.0.0.1', [0]);
      const open = new Socket();
      await new Promise<void>(resolve => open.connect(listener.port, '127.0.0.1', resolve));
      const closed = new Promise<void>(resolve =>
        open.once('close', () => {
          resolve();
        })
      );
      await listener.close();
      await closed;
      await expect(fetch(`http://127.0.0.1:${listener.port}/`)).rejects.toThrow();
    });
  });
});
