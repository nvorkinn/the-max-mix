// @vitest-environment node
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Action } from './actions.ts';
import { BluetoothError } from './bluetooth.ts';
import { dump, exchange } from './fixtures.ts';
import { HotspotError } from './hotspot.ts';
import { ERRORS, ScanError } from './nmcli.ts';
import type { ConnectRequest } from './nmcli.ts';
import { PAIRING_ERRORS } from './phone-pairing.ts';
import { parseDump } from './pipewire.ts';
import type { Choice } from './pipewire.ts';
import {
  handleRequest,
  isFromApp,
  journalLog,
  LOCAL_ORIGIN,
  parseAppLog,
  speakerNames,
  speakerVolumes
} from './server.ts';
import type { AppLog, Deps } from './server.ts';
import type { SoloistRequest } from './soloist.ts';
import type { SonosChange } from './sonos-events.ts';
import { SonosError } from './sonos.ts';
import type { SonosOperations, SonosRequest } from './sonos.ts';

// eslint-disable-next-line sonarjs/no-hardcoded-ip -- a made-up address of the Pi on a home network
const PI_ADDRESS = '192.168.1.42';

const ORIGIN = 'https://the-max-mix.countdown.build';
const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

const speaker = { address: 'AA:BB:CC:DD:EE:FF', name: 'Kitchen speaker', paired: true, connected: true };
const HOTSPOT_INFO = {
  ssid: 'THE MAX MIX setup',
  password: 'ABCD2345EF',
  // eslint-disable-next-line sonarjs/no-clear-text-protocols -- the setup page is plain http on the hotspot, by design
  url: 'http://10.42.0.1/',
  wifiQr: ['101'],
  urlQr: ['010']
};
const MONITOR = {
  adapter: null,
  devices: [],
  nearby: 3,
  verbose: false,
  log: [{ id: 1, time: 1, message: 'Scanning on' }]
};
const addressBody = (address: unknown) => ({ body: { address } });
const unavailable = () => Promise.reject(new BluetoothError('Bluetooth is not available on this device.'));
const otherFailure = () => Promise.reject(new Error('dbus: /private/path failed'));
const busy = () => Promise.reject(new BluetoothError('Bluetooth is busy. Wait a moment and try again.'));
const odd = () => Promise.reject(new Error('internal detail'));

/** A handover kept in memory, as handover.ts keeps it in a file. */
function memoryHandover(): Deps['handover'] {
  let kept: Record<string, string> | null = null;
  return {
    save: handover => {
      kept = handover;
      return Promise.resolve();
    },
    read: () => Promise.resolve(kept),
    remove: () => {
      kept = null;
      return Promise.resolve();
    }
  };
}

function fakes(overrides: Partial<Deps> = {}, hotspotError?: Error, isPairingFailing = false) {
  const verboseCalls: boolean[] = [];
  const pairingCalls: string[] = [];
  const presenceCalls: string[] = [];
  const hotspotCalls: string[] = [];
  const connected: string[] = [];
  const removed: string[] = [];
  const performed: Action[] = [];
  const brightnesses: (number | { percent: number; fade: boolean })[] = [];
  const soloistRequests: SoloistRequest[] = [];
  const soloistStops: true[] = [];
  const routed: Choice[][] = [];
  const volumes: [Choice, number][] = [];
  const played: SonosRequest[] = [];
  const logged: AppLog[] = [];
  const joined: ConnectRequest[] = [];
  const forgotten: string[] = [];
  const listeners = new Set<(change: SonosChange) => void>();
  let beats = 0;
  let clock = 0;
  const deps: Deps = {
    graph: () => Promise.resolve(parseDump(dump())),
    route: choices => {
      routed.push(choices);
      return Promise.resolve();
    },
    setVolume: (target, volume) => {
      volumes.push([target, volume]);
      return Promise.resolve(target.name === 'Gone' || target.id === 'raop_sink.Gone' ? 0 : 1);
    },
    perform: action => {
      performed.push(action);
      return Promise.resolve();
    },
    sonos: request => {
      played.push(request);
      if (request.room === 'Attic') {
        return Promise.reject(new SonosError('Sonos: speaker name not found in topology: Attic'));
      }
      return request.room === 'Broken' ? Promise.reject(new Error('internal detail')) : Promise.resolve();
    },
    sonosCalls: sonosFake(true),
    sonosEvents: {
      add: client => {
        listeners.add(client);
        return () => listeners.delete(client);
      }
    },
    now: () => (clock += 1500),
    heartbeat: () => {
      beats += 1;
    },
    log: entry => {
      logged.push(entry);
    },
    wifi: {
      scan: () => Promise.resolve([{ ssid: 'Home', signal: 80, bars: 4, security: 'psk' }]),
      current: () => Promise.resolve('Home'),
      address: () => PI_ADDRESS,
      connect: request => {
        joined.push(request);
        return Promise.resolve(request.password === 'right-password' ? { ok: true } : { ok: false, error: 'Nope.' });
      },
      saved: () => Promise.resolve(['Home', 'Office']),
      forget: ssid => {
        forgotten.push(ssid);
        return Promise.resolve({ ok: true });
      }
    },
    handover: memoryHandover(),
    app: url =>
      Promise.resolve(
        url.split('?', 1)[0] === '/'
          ? { type: 'text/html; charset=utf-8', body: Buffer.from('<p>app</p>'), cache: 'no-cache' }
          : null
      ),
    lyrics: query => {
      if (query.title === 'Down') return Promise.reject(new Error('unreachable'));
      return Promise.resolve(query.title === 'Known' ? { source: 'NetEase', lrc: '[00:01.00]Placeholder' } : null);
    },
    hotspot: {
      start: () => {
        hotspotCalls.push('start');
        return hotspotError ? Promise.reject(hotspotError) : Promise.resolve(HOTSPOT_INFO);
      },
      stop: () => {
        hotspotCalls.push('stop');
        return Promise.resolve();
      },
      status: () => ({ state: 'running' }),
      handlePortal: (_request, response) => {
        hotspotCalls.push('portal');
        response.writeHead(200).end('portal page');
        return Promise.resolve();
      }
    },
    screen: () => Promise.resolve({ width: 1280, height: 800, brightness_control: false }),
    setBrightness: (percent, isFaded) => {
      brightnesses.push(isFaded ? { percent, fade: isFaded } : percent);
      return Promise.resolve(1);
    },
    soloist: request => {
      soloistRequests.push(request);
      return Promise.resolve(request.person === 'no-key-person' ? 'no-key' : 'playing');
    },
    stopSoloist: () => {
      soloistStops.push(true);
      return Promise.resolve();
    },
    bluetooth: {
      list: () => Promise.resolve([speaker]),
      scan: () => Promise.resolve([speaker, { ...speaker, address: '11:22:33:44:55:66', paired: false }]),
      connect: address => {
        connected.push(address);
        return Promise.resolve(address === '00:00:00:00:00:01' ? { ok: false, error: 'Nope.' } : { ok: true });
      },
      remove: address => {
        removed.push(address);
        return Promise.resolve();
      }
    },
    phonePairing: {
      start: () => {
        pairingCalls.push('start');
        return isPairingFailing ? Promise.reject(new Error(PAIRING_ERRORS.unavailable)) : Promise.resolve();
      },
      pick: address => {
        pairingCalls.push(`pick ${address}`);
        return address === '1C:3C:78:F2:61:1D' ? Promise.resolve() : Promise.reject(new Error(PAIRING_ERRORS.gone));
      },
      stop: () => {
        pairingCalls.push('stop');
        return Promise.resolve();
      },
      status: () => ({ state: 'scanning', secondsLeft: 90, nearby: [] }),
      forget: address => {
        pairingCalls.push(`forget ${address}`);
        return Promise.resolve();
      }
    },
    presence: {
      status: () =>
        Promise.resolve({
          isChecking: true,
          phones: [{ address: '4F:00:00:00:00:03', name: 'Nikolai’s iPhone', isHere: true, lastSeen: 5 }]
        }),
      watch: () => {
        presenceCalls.push('watch');
      },
      unwatch: () => {
        presenceCalls.push('unwatch');
      }
    },
    bluetoothMonitor: {
      snapshot: () => Promise.resolve(MONITOR),
      setVerbose: on => {
        verboseCalls.push(on);
      }
    },
    ...overrides
  };
  return {
    deps,
    verboseCalls,
    pairingCalls,
    presenceCalls,
    hotspotCalls,
    connected,
    removed,
    performed,
    brightnesses,
    soloistRequests,
    soloistStops,
    routed,
    volumes,
    played,
    logged,
    joined,
    forgotten,
    listeners,
    beats: () => beats
  };
}

async function start(deps: Deps, origin = ORIGIN): Promise<string> {
  const handler = handleRequest(origin, deps);
  const server = createServer((request, response) => void handler(request, response));
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const NOW = { playing: true, positionMs: 1000, track: null, next: [], volume: 20, canSeek: true };

/** A fake Sonos: Kitchen when the speakers answer, else no answer at all. */
const fail = () => Promise.reject(new SonosError('Sonos: no speakers answered.'));
const resolved = () => Promise.resolve();

function sonosFake(isAnswering: boolean): SonosOperations {
  if (!isAnswering) {
    return {
      groups: fail,
      play: resolved,
      upNext: fail,
      now: fail,
      control: resolved,
      volume: resolved,
      joinGroup: resolved,
      leaveGroup: resolved,
      move: resolved,
      art: fail
    };
  }
  return {
    groups: () => Promise.resolve([{ id: 'RINCON_K:1', rooms: [{ id: 'RINCON_K', name: 'Kitchen' }] }]),
    play: resolved,
    upNext: () => Promise.resolve([]),
    now: () => Promise.resolve(NOW),
    control: resolved,
    volume: resolved,
    joinGroup: resolved,
    leaveGroup: resolved,
    move: resolved,
    art: room => Promise.resolve(room === 'Kitchen' ? { type: 'image/jpeg', body: Buffer.from('jpeg') } : null)
  };
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
    await expect(response.json()).resolves.toEqual({
      speakers: ['Kitchen', 'Lounge'],
      volumes: { Kitchen: 40 },
      outputs: [
        { id: 'raop_sink.Kitchen.local.7000', name: 'Kitchen', kind: 'airplay', volume: 40, linked: false },
        { id: 'raop_sink.Lounge.local.7000', name: 'Lounge', kind: 'airplay', volume: null, linked: false }
      ]
    });
  });

  it('says when PipeWire cannot be read', async () => {
    const base = await start(fakes({ graph: () => Promise.reject(new Error('no PipeWire')) }).deps);
    expect((await fetch(`${base}/speakers`)).status).toBe(503);
  });
});

describe('POST /soloist/person', () => {
  const body = { person: 'nikolai', server: 'https://countdown.run/api', secret: 'device-secret' };

  it('runs Soloist for the person, with the server origin', async () => {
    const { deps, soloistRequests } = fakes();
    const base = await start(deps);
    const response = await post(base, '/soloist/person', { body });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: 'playing' });
    expect(soloistRequests).toEqual([{ person: 'nikolai', server: 'https://countdown.run', secret: 'device-secret' }]);
  });

  it('answers why Soloist is not playing', async () => {
    const base = await start(fakes().deps);
    const response = await post(base, '/soloist/person', { body: { ...body, person: 'no-key-person' } });
    expect(await response.json()).toEqual({ state: 'no-key' });
  });

  it('refuses a bad body, and another origin', async () => {
    const { deps, soloistRequests } = fakes();
    const base = await start(deps);
    expect((await post(base, '/soloist/person', { body: { ...body, person: '../x' } })).status).toBe(400);
    expect((await post(base, '/soloist/person', { body: { ...body, server: 'http://countdown.run' } })).status).toBe(400);
    const elsewhere = await post(base, '/soloist/person', { origin: 'https://evil.example', body });
    expect(elsewhere.status).toBe(403);
    expect(soloistRequests).toEqual([]);
  });

  it('stops Soloist', async () => {
    const { deps, soloistStops } = fakes();
    const base = await start(deps);
    expect((await post(base, '/soloist/stop')).status).toBe(204);
    expect(soloistStops).toEqual([true]);
  });
});

describe('POST /display/brightness', () => {
  it("sets the screen's backlight", async () => {
    const { deps, brightnesses } = fakes();
    const base = await start(deps);
    expect((await post(base, '/display/brightness', { body: { percent: 40 } })).status).toBe(204);
    expect(brightnesses).toEqual([40]);
  });

  it('fades to it when asked', async () => {
    const { deps, brightnesses } = fakes();
    const base = await start(deps);
    expect((await post(base, '/display/brightness', { body: { percent: 24, fade: true } })).status).toBe(204);
    expect(brightnesses).toEqual([{ percent: 24, fade: true }]);
  });

  it('refuses a body that is not a percentage, and another origin', async () => {
    const { deps, brightnesses } = fakes();
    const base = await start(deps);
    expect((await post(base, '/display/brightness', { body: { percent: 0 } })).status).toBe(400);
    expect((await post(base, '/display/brightness', { body: {} })).status).toBe(400);
    const elsewhere = await post(base, '/display/brightness', {
      origin: 'https://evil.example',
      body: { percent: 40 }
    });
    expect(elsewhere.status).toBe(403);
    expect(brightnesses).toEqual([]);
  });

  it('says when the screen has no backlight', async () => {
    const base = await start(fakes({ setBrightness: () => Promise.resolve(0) }).deps);
    expect((await post(base, '/display/brightness', { body: { percent: 40 } })).status).toBe(404);
  });
});

describe('GET /screen', () => {
  it('answers the app with the screen', async () => {
    const base = await start(fakes().deps);
    const response = await fetch(`${base}/screen`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ width: 1280, height: 800, brightness_control: false });
  });

  it('says when there is no screen', async () => {
    const base = await start(fakes({ screen: () => Promise.resolve(null) }).deps);
    expect((await fetch(`${base}/screen`)).status).toBe(503);
  });
});

describe('POST', () => {
  it('runs the named kiosk action', async () => {
    const { deps, performed } = fakes();
    const base = await start(deps);
    const paths = ['/power/restart', '/power/reboot', '/display/wake', '/browser/forget-sign-ins'];
    const statuses = await Promise.all(paths.map(async path => (await post(base, path)).status));
    expect(statuses).toEqual([204, 204, 204, 204]);
    expect(new Set(performed)).toEqual(new Set(['restart', 'reboot', 'wake', 'forget-sign-ins']));
  });

  it('routes the sound to the outputs or speakers in the body, or to none', async () => {
    const { deps, routed } = fakes();
    const base = await start(deps);
    const id = 'raop_sink.Kitchen.local.7000';
    expect((await post(base, '/audio/route', { body: { outputs: [id] } })).status).toBe(204);
    expect((await post(base, '/audio/route', { body: { speakers: ['Kitchen', 'Kitchen'] } })).status).toBe(204);
    expect((await post(base, '/audio/route', { body: { speakers: [] } })).status).toBe(204);
    expect(routed).toEqual([[{ id }], [{ name: 'Kitchen' }], []]);
  });

  it('refuses a bad speaker list', async () => {
    const { deps, routed } = fakes();
    const base = await start(deps);
    expect((await post(base, '/audio/route', { body: { speakers: 'Kitchen' } })).status).toBe(400);
    expect((await post(base, '/audio/route', { body: { speakers: [''] } })).status).toBe(400);
    expect(routed).toEqual([]);
  });

  it('sets one output’s volume, and says when it is not on the network', async () => {
    const { deps, volumes } = fakes();
    const base = await start(deps);
    const id = 'raop_sink.Kitchen.local.7000';
    expect((await post(base, '/audio/volume', { body: { output: id, volume: 50 } })).status).toBe(204);
    expect((await post(base, '/audio/volume', { body: { output: 'raop_sink.Gone', volume: 5 } })).status).toBe(404);
    expect((await post(base, '/audio/volume', { body: { speaker: 'Kitchen', volume: 55 } })).status).toBe(204);
    expect((await post(base, '/audio/volume', { body: { speaker: 'Gone', volume: 10 } })).status).toBe(404);
    expect(volumes).toEqual([
      [{ id }, 50],
      [{ id: 'raop_sink.Gone' }, 5],
      [{ name: 'Kitchen' }, 55],
      [{ name: 'Gone' }, 10]
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

  it('plays a Spotify song on a Sonos room, and says why when it could not', async () => {
    const { deps, played } = fakes();
    const base = await start(deps);
    const uri = 'spotify:track:1234567890123456789012';
    expect((await post(base, '/sonos/play', { body: { room: 'Kitchen', uri } })).status).toBe(204);
    const missing = await post(base, '/sonos/play', { body: { room: 'Attic', uri } });
    expect(missing.status).toBe(502);
    await expect(missing.json()).resolves.toEqual({ error: 'Sonos: speaker name not found in topology: Attic' });
    const broken = await post(base, '/sonos/play', { body: { room: 'Broken', uri } });
    await expect(broken.json()).resolves.toEqual({ error: 'Sonos did not do that.' });
    expect(played.map(request => request.room)).toEqual(['Kitchen', 'Attic', 'Broken']);
  });

  it('says when the speakers do not answer, and refuses the old test calls', async () => {
    const { deps } = fakes();
    const base = await start({ ...deps, sonosCalls: sonosFake(false) });
    const failed = await fetch(`${base}/sonos/groups`, { headers: { Origin: ORIGIN } });
    expect(failed.status).toBe(502);
    await expect(failed.json()).resolves.toEqual({ error: 'Sonos: no speakers answered.' });
    expect((await fetch(`${base}/sonos/now?room=Kitchen`, { headers: { Origin: ORIGIN } })).status).toBe(502);
    expect((await post(base, '/sonos/test', { body: { room: 'Kitchen', test: 'library-queue' } })).status).toBe(404);
  });

  it('lists the Sonos groups, with how long it took, for the app only', async () => {
    const base = await start(fakes().deps);
    const get = (origin = ORIGIN) => fetch(`${base}/sonos/groups`, { headers: { Origin: origin } });
    const found = await get();
    expect(found.status).toBe(200);
    await expect(found.json()).resolves.toEqual({
      groups: [{ id: 'RINCON_K:1', rooms: [{ id: 'RINCON_K', name: 'Kitchen' }] }],
      ms: 1500
    });
    expect((await get('https://evil.example')).status).toBe(403);
  });

  it('streams Sonos changes to the app while it listens, and to the app only', async () => {
    const { deps, listeners } = fakes();
    const base = await start(deps);
    expect((await fetch(`${base}/sonos/events`, { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    expect(listeners.size).toBe(0);
    const controller = new AbortController();
    const stream = await fetch(`${base}/sonos/events`, { headers: { Origin: ORIGIN }, signal: controller.signal });
    expect(stream.headers.get('content-type')).toBe('text/event-stream');
    expect(listeners.size).toBe(1);
    for (const listener of listeners) listener('groups');
    const reader = (stream.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    const readEvent = async (text = ''): Promise<string> => {
      if (text.includes('data:')) return text;
      const { value } = await reader.read();
      return readEvent(text + decoder.decode(value, { stream: true }));
    };
    expect(await readEvent()).toContain('data: {"kind":"groups"}\n\n');
    controller.abort();
    await vi.waitFor(() => {
      expect(listeners.size).toBe(0);
    });
  });

  it('says what a room plays, and gives its artwork', async () => {
    const base = await start(fakes().deps);
    const get = (path: string) => fetch(`${base}${path}`, { headers: { Origin: ORIGIN } });
    const now = await get('/sonos/now?room=Kitchen');
    await expect(now.json()).resolves.toEqual(NOW);
    expect((await get('/sonos/now')).status).toBe(400);
    const art = await get('/sonos/art?room=Kitchen');
    expect(art.headers.get('content-type')).toBe('image/jpeg');
    expect(await art.text()).toBe('jpeg');
    expect((await get('/sonos/art?room=Attic')).status).toBe(404);
  });

  it('controls a room, its volume and its group', async () => {
    const { deps, played } = fakes();
    const base = await start(deps);
    expect(
      (await post(base, '/sonos/control', { body: { room: 'Kitchen', action: 'seek', positionMs: 5 } })).status
    ).toBe(204);
    expect((await post(base, '/sonos/volume', { body: { room: 'Kitchen', volume: 30 } })).status).toBe(204);
    expect((await post(base, '/sonos/join', { body: { room: 'Kitchen', to: 'Lounge' } })).status).toBe(204);
    expect((await post(base, '/sonos/leave', { body: { room: 'Kitchen' } })).status).toBe(204);
    expect((await post(base, '/sonos/move', { body: { room: 'Kitchen', from: 3, to: 0, name: 'Song' } })).status).toBe(
      204
    );
    expect((await post(base, '/sonos/volume', { body: { room: 'Kitchen', volume: 101 } })).status).toBe(400);
    expect(played.map(request => request.kind)).toEqual(['control', 'volume', 'join', 'leave', 'move']);
  });

  it('refuses a bad Sonos request, and one from another web page', async () => {
    const { deps, played } = fakes();
    const base = await start(deps);
    const uri = 'spotify:track:1234567890123456789012';
    expect((await post(base, '/sonos/play', { body: { room: 'Kitchen', uri: 'https://evil.example' } })).status).toBe(
      400
    );
    expect((await post(base, '/sonos/play', { body: { room: '--ip=10.0.0.1', uri } })).status).toBe(400);
    expect(
      (await post(base, '/sonos/play', { origin: 'https://evil.example', body: { room: 'Kitchen', uri } })).status
    ).toBe(403);
    expect(played).toEqual([]);
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
    // The old Wi-Fi setup page and its requests are gone.
    expect((await post(base, '/wifi')).status).toBe(404);
    expect((await post(base, '/wifi/done')).status).toBe(404);
    expect((await fetch(`${base}/wifi-setup`)).status).toBe(404);
    expect((await post(base, '/power/reboot')).status).toBe(503);
  });
});

describe('POST /heartbeat and /log', () => {
  it('passes heartbeats and app errors on, from the app only', async () => {
    const { deps, logged, beats } = fakes();
    const base = await start(deps);
    expect((await post(base, '/heartbeat')).status).toBe(204);
    expect((await post(base, '/heartbeat', { origin: 'https://evil.example' })).status).toBe(403);
    // This service's own origin is not the app's here, so it is any other page.
    expect((await post(base, '/heartbeat', { origin: LOCAL_ORIGIN })).status).toBe(403);
    expect(beats()).toBe(1);
    const body = { level: 'error', source: 'page', message: 'TypeError: x is undefined' };
    expect((await post(base, '/log', { body })).status).toBe(204);
    expect((await post(base, '/log', { body: { level: 'debug', message: 'x' } })).status).toBe(400);
    expect(logged).toEqual([body]);
  });

  it('takes heartbeats from the app when this service serves it', async () => {
    const { deps, beats } = fakes();
    const base = await start(deps, LOCAL_ORIGIN);
    expect((await post(base, '/heartbeat', { origin: LOCAL_ORIGIN })).status).toBe(204);
    expect((await post(base, '/heartbeat')).status).toBe(403);
    expect(beats()).toBe(1);
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

  it('tells the app, and only the app, which network the Wi-Fi is on', async () => {
    const base = await start(fakes().deps);
    const response = await fetch(`${base}/wifi/status`, { headers: { Origin: ORIGIN } });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ssid: 'Home', address: PI_ADDRESS });
    expect((await fetch(`${base}/wifi/status`)).status).toBe(403);
    expect((await fetch(`${base}/wifi/status`, { headers: { Origin: LOCAL_ORIGIN } })).status).toBe(403);
  });

  it('says why a scan failed', async () => {
    const wifi = {
      scan: () => Promise.reject(new ScanError(ERRORS.disabled)),
      current: vi.fn(),
      address: vi.fn(),
      connect: vi.fn(),
      saved: vi.fn(),
      forget: vi.fn()
    };
    const base = await start(fakes({ wifi }).deps);
    const response = await fetch(`${base}/wifi/networks`);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: ERRORS.disabled });
  });

  it('joins a network for the app this service serves, and says when it could not', async () => {
    const { deps, joined } = fakes();
    const base = await start(deps, LOCAL_ORIGIN);
    const request = { ssid: 'Home', password: 'right-password', hidden: false, security: 'psk' };
    const joinedHome = await post(base, '/wifi/connect', { origin: LOCAL_ORIGIN, body: request });
    await expect(joinedHome.json()).resolves.toEqual({ ok: true });
    const failed = await post(base, '/wifi/connect', {
      origin: LOCAL_ORIGIN,
      body: { ...request, password: 'wrong-one' }
    });
    await expect(failed.json()).resolves.toEqual({ ok: false, error: 'Nope.' });
    expect(joined.map(entry => entry.password)).toEqual(['right-password', 'wrong-one']);
  });

  it('refuses other pages, a hosted app, and a bad request', async () => {
    const { deps, joined } = fakes();
    const base = await start(deps, LOCAL_ORIGIN);
    const request = { ssid: 'Home', password: 'right-password', hidden: false, security: 'psk' };
    expect((await post(base, '/wifi/connect', { origin: 'https://evil.example', body: request })).status).toBe(403);
    expect((await post(base, '/wifi/connect', { body: request })).status).toBe(403);
    expect((await post(base, '/wifi/connect', { origin: LOCAL_ORIGIN, body: { ssid: 'Home' } })).status).toBe(400);
    const hosted = await start(deps);
    expect((await post(hosted, '/wifi/connect', { body: request })).status).toBe(403);
    expect(joined).toEqual([]);
  });
});

describe('saved Wi-Fi networks', () => {
  it('lists them for the app only', async () => {
    const base = await start(fakes().deps);
    const response = await fetch(`${base}/wifi/saved`, { headers: { Origin: ORIGIN } });
    await expect(response.json()).resolves.toEqual({ networks: ['Home', 'Office'] });
    expect((await fetch(`${base}/wifi/saved`)).status).toBe(403);
  });

  it('forgets one for the app this service serves, and nothing for anyone else', async () => {
    const { deps, forgotten } = fakes();
    const base = await start(deps, LOCAL_ORIGIN);
    const forgot = await post(base, '/wifi/forget', { origin: LOCAL_ORIGIN, body: { ssid: 'Home' } });
    await expect(forgot.json()).resolves.toEqual({ ok: true });
    expect(
      (await post(base, '/wifi/forget', { origin: 'https://evil.example', body: { ssid: 'Office' } })).status
    ).toBe(403);
    expect((await post(base, '/wifi/forget', { origin: LOCAL_ORIGIN, body: {} })).status).toBe(400);
    expect(forgotten).toEqual(['Home']);
  });
});

describe('the setup hotspot', () => {
  it('starts for the app only, and says why it could not start', async () => {
    const { deps, hotspotCalls } = fakes();
    const base = await start(deps, LOCAL_ORIGIN);
    expect((await post(base, '/wifi/hotspot', { origin: 'https://evil.example' })).status).toBe(403);
    expect(hotspotCalls).toEqual([]);
    const started = await post(base, '/wifi/hotspot', { origin: LOCAL_ORIGIN });
    expect(started.status).toBe(200);
    await expect(started.json()).resolves.toEqual(HOTSPOT_INFO);

    vi.spyOn(console, 'warn').mockReturnValue();
    const failing = await start(
      fakes({}, new HotspotError('There is no Wi-Fi adapter to make a hotspot with.')).deps,
      LOCAL_ORIGIN
    );
    const refused = await post(failing, '/wifi/hotspot', { origin: LOCAL_ORIGIN });
    expect(refused.status).toBe(503);
    await expect(refused.json()).resolves.toEqual({ error: 'There is no Wi-Fi adapter to make a hotspot with.' });
    const other = await start(fakes({}, new Error('internal detail')).deps, LOCAL_ORIGIN);
    await expect((await post(other, '/wifi/hotspot', { origin: LOCAL_ORIGIN })).json()).resolves.toEqual({
      error: 'The hotspot could not be started.'
    });
  });

  it('stops for the app only, and reports where it is', async () => {
    const { deps, hotspotCalls } = fakes();
    const base = await start(deps, LOCAL_ORIGIN);
    expect((await post(base, '/wifi/hotspot/stop', { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(base, '/wifi/hotspot/stop', { origin: LOCAL_ORIGIN })).status).toBe(204);
    expect(hotspotCalls).toEqual(['stop']);
    await expect((await fetch(`${base}/wifi/hotspot`)).json()).resolves.toEqual({ state: 'running' });
  });

  it('gives a request that came over the hotspot the hotspot’s page and nothing of the kiosk’s own', async () => {
    const { deps, hotspotCalls, performed, beats } = fakes();
    const handle = handleRequest(ORIGIN, deps);
    for (const [method, url] of [
      ['POST', '/heartbeat'],
      ['POST', '/power/reboot'],
      ['POST', '/power/restart'],
      ['POST', '/wifi/connect'],
      ['GET', '/speakers']
    ] as const) {
      // Whatever Origin it claims: a client on the hotspot can send any.

      const { request, response, sent } = exchange(method, url, { origin: ORIGIN, body: {} });
      // eslint-disable-next-line no-await-in-loop
      await handle(request, response);
      expect(sent.body).toBe('portal page');
    }
    expect(hotspotCalls).toEqual(['portal', 'portal', 'portal', 'portal', 'portal']);
    expect(performed).toEqual([]);
    expect(beats()).toBe(0);
  });

  it('still serves the kiosk’s own requests from this machine', async () => {
    const { deps, beats, hotspotCalls } = fakes();
    const { request, response } = exchange('POST', '/heartbeat', { origin: ORIGIN, localAddress: '127.0.0.1' });
    await handleRequest(ORIGIN, deps)(request, response);
    expect(beats()).toBe(1);
    expect(hotspotCalls).toEqual([]);
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

describe('Bluetooth speakers', () => {
  it('lists what BlueZ knows, and scans, for the app only', async () => {
    const base = await start(fakes().deps);
    const listed = await fetch(`${base}/bluetooth/devices`, { headers: { Origin: ORIGIN } });
    await expect(listed.json()).resolves.toEqual({ devices: [speaker] });
    expect((await fetch(`${base}/bluetooth/devices`)).status).toBe(403);
    const scanned = await post(base, '/bluetooth/scan');
    expect(((await scanned.json()) as { devices: unknown[] }).devices).toHaveLength(2);
    expect((await post(base, '/bluetooth/scan', { origin: 'https://example.com' })).status).toBe(403);
  });

  it('says why Bluetooth failed, in words that are safe to show', async () => {
    const base = await start(
      fakes({ bluetooth: { ...fakes().deps.bluetooth, list: unavailable, scan: otherFailure } }).deps
    );
    const listed = await fetch(`${base}/bluetooth/devices`, { headers: { Origin: ORIGIN } });
    expect(listed.status).toBe(503);
    await expect(listed.json()).resolves.toEqual({ error: 'Bluetooth is not available on this device.' });
    const scanned = await post(base, '/bluetooth/scan');
    await expect(scanned.json()).resolves.toEqual({ error: 'Bluetooth failed.' });
  });

  it('connects and forgets a speaker or phone by a checked address', async () => {
    const { deps, connected, removed, pairingCalls } = fakes();
    const base = await start(deps);
    const ok = await post(base, '/bluetooth/connect', addressBody('aa:bb:cc:dd:ee:ff'));
    await expect(ok.json()).resolves.toEqual({ ok: true });
    const refused = await post(base, '/bluetooth/connect', addressBody('00:00:00:00:00:01'));
    await expect(refused.json()).resolves.toEqual({ ok: false, error: 'Nope.' });
    expect(connected).toEqual(['AA:BB:CC:DD:EE:FF', '00:00:00:00:00:01']);
    expect((await post(base, '/bluetooth/remove', addressBody('AA:BB:CC:DD:EE:FF'))).status).toBe(204);
    expect(removed).toEqual(['AA:BB:CC:DD:EE:FF']);
    expect(pairingCalls).toEqual(['forget AA:BB:CC:DD:EE:FF']);
    const refusals = await Promise.all(
      ['/bluetooth/connect', '/bluetooth/remove'].flatMap(path =>
        ['not an address; rm -rf /', 7].map(address => post(base, path, addressBody(address)))
      )
    );
    expect(refusals.map(refusal => refusal.status)).toEqual([400, 400, 400, 400]);
    expect(connected).toHaveLength(2);
    expect(removed).toHaveLength(1);
  });

  it('answers a connect that throws with the message, not an error status', async () => {
    const base = await start(fakes({ bluetooth: { ...fakes().deps.bluetooth, connect: busy } }).deps);
    const first = await post(base, '/bluetooth/connect', addressBody('AA:BB:CC:DD:EE:FF'));
    await expect(first.json()).resolves.toEqual({
      ok: false,
      error: 'Bluetooth is busy. Wait a moment and try again.'
    });
    const other = await start(fakes({ bluetooth: { ...fakes().deps.bluetooth, connect: odd } }).deps);
    const second = await post(other, '/bluetooth/connect', addressBody('AA:BB:CC:DD:EE:FF'));
    await expect(second.json()).resolves.toEqual({ ok: false, error: 'Bluetooth failed.' });
  });
});

describe('Bluetooth monitor', () => {
  it('reports what BlueZ says, for the app only', async () => {
    const base = await start(fakes().deps);
    const answer = await fetch(`${base}/bluetooth/monitor`, { headers: { Origin: ORIGIN } });
    await expect(answer.json()).resolves.toEqual({
      ...MONITOR,
      pairing: { state: 'scanning', secondsLeft: 90, nearby: [] },
      phones: [{ address: '4F:00:00:00:00:03', name: 'Nikolai’s iPhone', isHere: true, lastSeen: 5 }],
      presenceChecking: true
    });
    expect((await fetch(`${base}/bluetooth/monitor`)).status).toBe(403);
  });

  it('says Bluetooth is not available when BlueZ is not there', async () => {
    const base = await start(fakes({ bluetoothMonitor: { snapshot: otherFailure, setVerbose: vi.fn() } }).deps);
    const answer = await fetch(`${base}/bluetooth/monitor`, { headers: { Origin: ORIGIN } });
    expect(answer.status).toBe(503);
    await expect(answer.json()).resolves.toEqual({ error: 'Bluetooth is not available on this device.' });
  });

  it('logs unpaired devices too when the app asks', async () => {
    const { deps, verboseCalls } = fakes();
    const base = await start(deps);
    expect((await post(base, '/bluetooth/monitor', { body: { verbose: true } })).status).toBe(204);
    expect((await post(base, '/bluetooth/monitor', { body: { verbose: 'yes' } })).status).toBe(400);
    expect(
      (await post(base, '/bluetooth/monitor', { body: { verbose: false }, origin: 'https://example.com' })).status
    ).toBe(403);
    expect(verboseCalls).toEqual([true]);
  });

  it('listens for the saved phones while the app watches, for the app only', async () => {
    const { deps, presenceCalls } = fakes();
    const base = await start(deps);
    expect((await post(base, '/bluetooth/presence', { body: { watch: true } })).status).toBe(204);
    expect((await post(base, '/bluetooth/presence', { body: { watch: false } })).status).toBe(204);
    expect((await post(base, '/bluetooth/presence', { body: { watch: 'yes' } })).status).toBe(400);
    expect(
      (await post(base, '/bluetooth/presence', { body: { watch: true }, origin: 'https://example.com' })).status
    ).toBe(403);
    expect(presenceCalls).toEqual(['watch', 'unwatch']);
  });
});

describe('Pair my phone', () => {
  it('starts looking for phones, pairs with the one picked and stops, for the app only', async () => {
    const { deps, pairingCalls } = fakes();
    const base = await start(deps);
    expect((await post(base, '/bluetooth/pair-phone')).status).toBe(204);
    expect((await post(base, '/bluetooth/pair-phone/pick', addressBody('1C:3C:78:F2:61:1D'))).status).toBe(204);
    expect((await post(base, '/bluetooth/pair-phone/stop')).status).toBe(204);
    expect((await post(base, '/bluetooth/pair-phone', { origin: 'https://example.com' })).status).toBe(403);
    expect(pairingCalls).toEqual(['start', 'pick 1C:3C:78:F2:61:1D', 'stop']);
  });

  it('says why a pick is refused, and turns down one that is not an address', async () => {
    const base = await start(fakes().deps);
    const gone = await post(base, '/bluetooth/pair-phone/pick', addressBody('AA:BB:CC:DD:EE:FF'));
    expect(gone.status).toBe(409);
    await expect(gone.json()).resolves.toEqual({ error: PAIRING_ERRORS.gone });
    expect((await post(base, '/bluetooth/pair-phone/pick', { body: { address: 'nope' } })).status).toBe(400);
  });

  it('says why when Bluetooth would not start pairing', async () => {
    const base = await start(fakes({}, undefined, true).deps);
    const answer = await post(base, '/bluetooth/pair-phone');
    expect(answer.status).toBe(503);
    await expect(answer.json()).resolves.toEqual({ error: PAIRING_ERRORS.unavailable });
  });
});

describe('the app installed on the Pi', () => {
  it('serves its files with the site headers, and nothing for a file it does not have', async () => {
    const base = await start(fakes().deps, LOCAL_ORIGIN);
    const page = await fetch(`${base}/?kiosk=1`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(page.headers.get('cache-control')).toBe('no-cache');
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    expect(page.headers.get('x-frame-options')).toBe('DENY');
    await expect(page.text()).resolves.toBe('<p>app</p>');
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
  });

  it('answers its same-origin GETs, which carry no Origin', async () => {
    const lyrics = vi.fn<Deps['lyrics']>().mockResolvedValue(null);
    const base = await start(fakes({ lyrics }).deps, LOCAL_ORIGIN);
    const sameOrigin = { headers: { 'Sec-Fetch-Site': 'same-origin' } };
    expect((await fetch(`${base}/lyrics?title=Known&artist=Someone`, sameOrigin)).status).toBe(404);
    expect(lyrics).toHaveBeenCalledOnce();
    expect((await fetch(`${base}/wifi/status`, sameOrigin)).status).toBe(200);
    expect((await fetch(`${base}/wifi/status`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
  });
});

const request = (headers: Record<string, string>) => ({ headers }) as unknown as Parameters<typeof isFromApp>[0];

describe('isFromApp', () => {
  it('goes by the Origin a request names', () => {
    expect(isFromApp(request({ origin: ORIGIN }), ORIGIN)).toBe(true);
    expect(isFromApp(request({ origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' }), LOCAL_ORIGIN)).toBe(
      false
    );
  });

  it('takes a same-origin request without one only when the app is the local copy', () => {
    expect(isFromApp(request({ 'sec-fetch-site': 'same-origin' }), LOCAL_ORIGIN)).toBe(true);
    expect(isFromApp(request({ 'sec-fetch-site': 'same-origin' }), ORIGIN)).toBe(false);
    expect(isFromApp(request({}), LOCAL_ORIGIN)).toBe(false);
  });
});

describe('the handover from the hosted app to the local copy', () => {
  const items = { 'maxmix.people': '[{"id":"nikolai"}]', 'maxmix.deviceId': 'abc' };

  it("takes the hosted app's items, and gives them to the local copy only", async () => {
    const handover = memoryHandover();
    const hosted = await start(fakes({ handover }).deps);
    expect((await post(hosted, '/handover', { origin: 'https://evil.example', body: { items } })).status).toBe(403);
    expect((await post(hosted, '/handover', { body: { items: { 'other.key': 'x' } } })).status).toBe(400);
    expect((await post(hosted, '/handover', { body: { items } })).status).toBe(204);
    expect((await fetch(`${hosted}/handover`, { headers: { Origin: ORIGIN } })).status).toBe(403);

    const local = await start(fakes({ handover }).deps, LOCAL_ORIGIN);
    const sameOrigin = { headers: { 'Sec-Fetch-Site': 'same-origin' } };
    expect((await fetch(`${local}/handover`)).status).toBe(403);
    const taken = await fetch(`${local}/handover`, sameOrigin);
    await expect(taken.json()).resolves.toEqual({ items });
    expect((await post(local, '/handover', { origin: LOCAL_ORIGIN, body: { items } })).status).toBe(403);
    expect((await post(local, '/handover/done', { origin: LOCAL_ORIGIN })).status).toBe(204);
    expect((await fetch(`${local}/handover`, sameOrigin)).status).toBe(404);
  });
});
