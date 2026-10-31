// @vitest-environment node
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Action } from './actions.ts';
import { dump } from './fixtures.ts';
import { parseDump } from './pipewire.ts';
import { handleRequest, speakerNames } from './server.ts';
import type { Deps } from './server.ts';

const ORIGIN = 'https://the-max-mix.vercel.app';
const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

function fakes(overrides: Partial<Deps> = {}) {
  const performed: Action[] = [];
  const routed: string[][] = [];
  const deps: Deps = {
    graph: () => Promise.resolve(parseDump(dump())),
    route: speakers => {
      routed.push(speakers);
      return Promise.resolve();
    },
    perform: action => {
      performed.push(action);
      return Promise.resolve();
    },
    ...overrides
  };
  return { deps, performed, routed };
}

async function start(deps: Deps): Promise<string> {
  const handler = handleRequest(ORIGIN, deps);
  const server = createServer((request, response) => void handler(request, response));
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const post = (base: string, path: string, init: { origin?: string; body?: unknown } = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { Origin: init.origin ?? ORIGIN, 'Content-Type': 'application/json' },
    ...(init.body !== undefined && { body: JSON.stringify(init.body) })
  });

describe('speakerNames', () => {
  it('lists the AirPlay sinks only, sorted', () => {
    const graph = parseDump(dump());
    expect(speakerNames(graph)).toEqual(['Kitchen', 'Lounge']);
  });
});

describe('GET /speakers', () => {
  it('answers the app with the speakers', async () => {
    const base = await start(fakes().deps);
    const response = await fetch(`${base}/speakers`);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    await expect(response.json()).resolves.toEqual({ speakers: ['Kitchen', 'Lounge'] });
  });

  it('says when PipeWire cannot be read', async () => {
    const base = await start(fakes({ graph: () => Promise.reject(new Error('no PipeWire')) }).deps);
    expect((await fetch(`${base}/speakers`)).status).toBe(503);
  });
});

describe('POST', () => {
  it('runs the named kiosk action', async () => {
    const { deps, performed } = fakes();
    const base = await start(deps);
    const paths = ['/power/update', '/power/restart', '/power/reboot', '/display/wake', '/wifi'];
    const statuses = await Promise.all(paths.map(async path => (await post(base, path)).status));
    expect(statuses).toEqual([204, 204, 204, 204, 204]);
    expect(new Set(performed)).toEqual(new Set(['update', 'restart', 'reboot', 'wake', 'wifi']));
  });

  it('routes the sound to the speakers in the body, or to none', async () => {
    const { deps, routed } = fakes();
    const base = await start(deps);
    expect((await post(base, '/audio/route', { body: { speakers: ['Kitchen', 'Kitchen'] } })).status).toBe(204);
    expect((await post(base, '/audio/route', { body: { speakers: [] } })).status).toBe(204);
    expect(routed).toEqual([['Kitchen'], []]);
  });

  it('refuses a bad speaker list', async () => {
    const { deps, routed } = fakes();
    const base = await start(deps);
    expect((await post(base, '/audio/route', { body: { speakers: 'Kitchen' } })).status).toBe(400);
    expect((await post(base, '/audio/route', { body: { speakers: [''] } })).status).toBe(400);
    expect(routed).toEqual([]);
  });

  it('does nothing for another web page', async () => {
    const { deps, performed } = fakes();
    const base = await start(deps);
    expect((await post(base, '/power/reboot', { origin: 'https://evil.example' })).status).toBe(403);
    expect((await fetch(`${base}/power/reboot`, { method: 'POST' })).status).toBe(403);
    expect(performed).toEqual([]);
  });

  it('knows no other path, and says when an action failed', async () => {
    const perform = vi.fn().mockRejectedValue(new Error('polkit said no'));
    const base = await start(fakes({ perform }).deps);
    expect((await post(base, '/power/halt')).status).toBe(404);
    expect((await post(base, '/power/reboot')).status).toBe(503);
  });
});

describe('the preflight', () => {
  it('allows the app’s POSTs', async () => {
    const base = await start(fakes().deps);
    const preflight = await fetch(`${base}/audio/route`, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-methods')).toContain('POST');
    expect(preflight.headers.get('access-control-allow-private-network')).toBe('true');
  });
});
