// @vitest-environment node
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Action } from './actions.ts';
import { dump } from './fixtures.ts';
import { parseDump } from './pipewire.ts';
import { handleRequest, journalLog, parseAppLog, speakerNames } from './server.ts';
import type { AppLog, Deps } from './server.ts';

const ORIGIN = 'https://the-max-mix.vercel.app';
const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

function fakes(overrides: Partial<Deps> = {}) {
  const performed: Action[] = [];
  const routed: string[][] = [];
  const logged: AppLog[] = [];
  let beats = 0;
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
    heartbeat: () => {
      beats += 1;
    },
    log: entry => logged.push(entry),
    ...overrides
  };
  return { deps, performed, routed, logged, beats: () => beats };
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
    const paths = ['/power/restart', '/power/reboot', '/display/wake', '/wifi'];
    const statuses = await Promise.all(paths.map(async path => (await post(base, path)).status));
    expect(statuses).toEqual([204, 204, 204, 204]);
    expect(new Set(performed)).toEqual(new Set(['restart', 'reboot', 'wake', 'wifi']));
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
    // The update is a WebSocket now: a plain POST to its path starts nothing.
    expect((await post(base, '/power/update')).status).toBe(404);
    expect((await post(base, '/power/reboot')).status).toBe(503);
  });
});

describe('POST /heartbeat and /log', () => {
  it('passes heartbeats and app errors on, from the app only', async () => {
    const { deps, logged, beats } = fakes();
    const base = await start(deps);
    expect((await post(base, '/heartbeat')).status).toBe(204);
    expect((await post(base, '/heartbeat', { origin: 'https://evil.example' })).status).toBe(403);
    expect(beats()).toBe(1);
    const body = { level: 'error', source: 'page', message: 'TypeError: x is undefined' };
    expect((await post(base, '/log', { body })).status).toBe(204);
    expect((await post(base, '/log', { body: { level: 'debug', message: 'x' } })).status).toBe(400);
    expect(logged).toEqual([body]);
  });
});

describe('parseAppLog', () => {
  it('keeps one line, a short message and a plain source', () => {
    expect(
      parseAppLog({ level: 'warn', source: 'a b\n', message: `Error: x\n    at f (app.js:1)\n${'y'.repeat(3000)}` })
    ).toEqual({
      level: 'warn',
      source: 'ab',
      message: expect.stringMatching(/^Error: x \| at f \(app\.js:1\) \| y+$/)
    });
    expect(parseAppLog({ level: 'error', message: 'z'.repeat(3000) })?.message).toHaveLength(2000);
    expect(parseAppLog(null)).toBeNull();
    expect(parseAppLog({ level: 'error' })).toBeNull();
  });
});

describe('journalLog', () => {
  it('writes at most 30 lines a minute, then says how many it dropped', () => {
    const lines: string[] = [];
    let now = 0;
    const log = journalLog(
      line => lines.push(line),
      () => now
    );
    for (let i = 0; i < 35; i++) log({ level: 'error', source: 'page', message: `e${i}` });
    expect(lines).toHaveLength(30);
    expect(lines[0]).toBe('app error (page): e0');
    now = 60_000;
    log({ level: 'warn', source: '', message: 'later' });
    expect(lines.slice(30)).toEqual(['app: 5 more log lines were dropped', 'app warn: later']);
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
