// @vitest-environment node
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Action } from './actions.ts';
import { dump } from './fixtures.ts';
import { ERRORS, ScanError } from './nmcli.ts';
import type { ConnectRequest } from './nmcli.ts';
import { parseDump } from './pipewire.ts';
import { handleRequest, journalLog, LOCAL_ORIGIN, parseAppLog, speakerNames, speakerVolumes } from './server.ts';
import type { AppLog, Deps } from './server.ts';

const ORIGIN = 'https://the-max-mix.vercel.app';
const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

function fakes(overrides: Partial<Deps> = {}) {
  const performed: Action[] = [];
  const routed: string[][] = [];
  const volumes: [string, number][] = [];
  const logged: AppLog[] = [];
  const joined: ConnectRequest[] = [];
  let beats = 0;
  let closed = 0;
  const deps: Deps = {
    graph: () => Promise.resolve(parseDump(dump())),
    route: speakers => {
      routed.push(speakers);
      return Promise.resolve();
    },
    setVolume: (speaker, volume) => {
      volumes.push([speaker, volume]);
      return Promise.resolve(speaker === 'Gone' ? 0 : 1);
    },
    perform: action => {
      performed.push(action);
      return Promise.resolve();
    },
    heartbeat: () => {
      beats += 1;
    },
    log: entry => {
      logged.push(entry);
    },
    wifi: {
      scan: () => Promise.resolve([{ ssid: 'Home', signal: 80, bars: 4, security: 'psk' }]),
      connect: request => {
        joined.push(request);
        return Promise.resolve(request.password === 'right-password' ? { ok: true } : { ok: false, error: 'Nope.' });
      },
      done: () => {
        closed += 1;
      }
    },
    asset: url => Promise.resolve(url === '/wifi-setup' ? { type: 'text/html', body: '<p>page</p>' } : null),
    lyrics: query => {
      if (query.title === 'Down') return Promise.reject(new Error('unreachable'));
      return Promise.resolve(query.title === 'Known' ? { source: 'NetEase', lrc: '[00:01.00]Placeholder' } : null);
    },
    ...overrides
  };
  return { deps, performed, routed, volumes, logged, joined, beats: () => beats, closed: () => closed };
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

  it('gives the volume of each speaker that reports one, in percent', () => {
    const graph = parseDump(dump());
    expect(speakerVolumes(graph)).toEqual({ Kitchen: 40 });
  });
});

describe('GET /speakers', () => {
  it('answers the app with the speakers', async () => {
    const base = await start(fakes().deps);
    const response = await fetch(`${base}/speakers`);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    await expect(response.json()).resolves.toEqual({ speakers: ['Kitchen', 'Lounge'], volumes: { Kitchen: 40 } });
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

  it('sets one speaker’s volume, and says when it is not on the network', async () => {
    const { deps, volumes } = fakes();
    const base = await start(deps);
    expect((await post(base, '/audio/volume', { body: { speaker: 'Kitchen', volume: 55 } })).status).toBe(204);
    expect((await post(base, '/audio/volume', { body: { speaker: 'Gone', volume: 10 } })).status).toBe(404);
    expect(volumes).toEqual([
      ['Kitchen', 55],
      ['Gone', 10]
    ]);
  });

  it('refuses a bad volume', async () => {
    const { deps, volumes } = fakes();
    const base = await start(deps);
    for (const body of [
      { speaker: 'Kitchen', volume: 101 },
      { speaker: 'Kitchen', volume: 0.5 },
      { volume: 5 },
      null
    ]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await post(base, '/audio/volume', { body })).status).toBe(400);
    }
    expect(volumes).toEqual([]);
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
    // The Wi-Fi setup page sends heartbeats too, but nothing else from its origin reaches the app's requests.
    expect((await post(base, '/heartbeat', { origin: LOCAL_ORIGIN })).status).toBe(204);
    expect(beats()).toBe(2);
    expect((await post(base, '/power/reboot', { origin: LOCAL_ORIGIN })).status).toBe(403);
    const body = { level: 'error', source: 'page', message: 'TypeError: x is undefined' };
    expect((await post(base, '/log', { body })).status).toBe(204);
    expect((await post(base, '/log', { body: { level: 'debug', message: 'x' } })).status).toBe(400);
    expect(logged).toEqual([body]);
  });
});

describe('parseAppLog', () => {
  it('keeps one line, a short message and a plain source', () => {
    const entry = parseAppLog({
      level: 'warn',
      source: 'a b\n',
      message: `Error: x\n    at f (app.js:1)\n${'y'.repeat(30)}`
    });
    expect(entry).toEqual({ level: 'warn', source: 'ab', message: `Error: x | at f (app.js:1) | ${'y'.repeat(30)}` });
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
      line => {
        lines.push(line);
      },
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

describe('Wi-Fi', () => {
  it('lists the networks in range', async () => {
    const base = await start(fakes().deps);
    const response = await fetch(`${base}/wifi/networks`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      networks: [{ ssid: 'Home', signal: 80, bars: 4, security: 'psk' }]
    });
  });

  it('says why a scan failed', async () => {
    const wifi = { scan: () => Promise.reject(new ScanError(ERRORS.disabled)), connect: vi.fn(), done: vi.fn() };
    const base = await start(fakes({ wifi }).deps);
    const response = await fetch(`${base}/wifi/networks`);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: ERRORS.disabled });
  });

  it('joins a network for the setup page, and says when it could not', async () => {
    const { deps, joined } = fakes();
    const base = await start(deps);
    const request = { ssid: 'Home', password: 'right-password', hidden: false, security: 'psk' };
    const done = await post(base, '/wifi/connect', { origin: LOCAL_ORIGIN, body: request });
    await expect(done.json()).resolves.toEqual({ ok: true });
    const failed = await post(base, '/wifi/connect', {
      origin: LOCAL_ORIGIN,
      body: { ...request, password: 'wrong-one' }
    });
    await expect(failed.json()).resolves.toEqual({ ok: false, error: 'Nope.' });
    expect(joined.map(entry => entry.password)).toEqual(['right-password', 'wrong-one']);
  });

  it('refuses the app and other pages, and a bad request', async () => {
    const { deps, joined } = fakes();
    const base = await start(deps);
    const request = { ssid: 'Home', password: 'right-password', hidden: false, security: 'psk' };
    expect((await post(base, '/wifi/connect', { body: request })).status).toBe(403);
    expect((await post(base, '/wifi/connect', { origin: 'https://evil.example', body: request })).status).toBe(403);
    expect((await post(base, '/wifi/connect', { origin: LOCAL_ORIGIN, body: { ssid: 'Home' } })).status).toBe(400);
    expect(joined).toEqual([]);
  });
});

describe('the Wi-Fi setup page', () => {
  it('is served with its scripts', async () => {
    const base = await start(fakes().deps);
    const page = await fetch(`${base}/wifi-setup`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toBe('text/html');
    await expect(page.text()).resolves.toBe('<p>page</p>');
    expect((await fetch(`${base}/nothing-here`)).status).toBe(404);
  });

  it('closes when it is done, for its own origin only', async () => {
    const { deps, closed } = fakes();
    const base = await start(deps);
    expect((await post(base, '/wifi/done')).status).toBe(403);
    expect(closed()).toBe(0);
    expect((await post(base, '/wifi/done', { origin: LOCAL_ORIGIN })).status).toBe(204);
    expect(closed()).toBe(1);
  });
});

const ask = (base: string, query: string, origin: string | null = ORIGIN) =>
  fetch(`${base}/lyrics?${query}`, origin ? { headers: { Origin: origin } } : {});

describe('GET /lyrics', () => {
  it('answers with the lyrics and where they came from', async () => {
    const base = await start(fakes().deps);
    const response = await ask(base, 'title=Known&artist=Someone&duration=200000');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ source: 'NetEase', lrc: '[00:01.00]Placeholder' });
  });

  it('says when there are none, when the sources are down, and when the request is wrong', async () => {
    const base = await start(fakes().deps);
    expect((await ask(base, 'title=Unknown&artist=Someone')).status).toBe(404);
    expect((await ask(base, 'title=Down&artist=Someone')).status).toBe(502);
    expect((await ask(base, 'title=Known')).status).toBe(400);
  });

  it('answers the app only', async () => {
    const lyrics = vi.fn<Deps['lyrics']>();
    const base = await start(fakes({ lyrics }).deps);
    expect((await ask(base, 'title=Known&artist=Someone', null)).status).toBe(403);
    expect((await ask(base, 'title=Known&artist=Someone', 'https://example.com')).status).toBe(403);
    expect(lyrics).not.toHaveBeenCalled();
  });
});
