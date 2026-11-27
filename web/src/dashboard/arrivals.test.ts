import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeviceArrivals } from 'countdown-api';
import fixture from '../../../vendor/countdown-api/src/countdown_api/fixtures/device_panels.json';
import { forgetArrivals, fromServer, mockAnswer, readArrivals } from './arrivals';

const config = vi.hoisted(() => ({
  serverClient: vi.fn<() => { baseUrl: string; secret: string } | null>()
}));
vi.mock('../countdown/config', () => ({ serverClient: config.serverClient }));

// countdown-api's example answer, read a minute after the server fetched it.
const ANSWER = (fixture as unknown as { arrivals: DeviceArrivals }).arrivals;
const NOW = new Date('2026-10-17T12:01:00Z');

describe("countdown-server's departures as the Dashboard's", () => {
  it('gives each stop its trains or buses, soonest first, named without "Underground Station"', () => {
    const arrivals = fromServer(ANSWER, NOW);
    expect(arrivals?.updatedAt).toBe('2026-10-17T12:00:00Z');
    expect(arrivals?.stops.slice(0, 2)).toEqual([
      {
        name: 'Kennington',
        mode: 'tube',
        arrivals: [
          { route: 'Northern', destination: 'Morden', due: '2026-10-17T12:02:00Z' },
          { route: 'Northern', destination: 'Edgware via Bank', due: '2026-10-17T12:04:00Z' }
        ]
      },
      {
        name: 'Elephant & Castle',
        mode: 'bus',
        arrivals: [
          { route: '171', destination: 'Elephant & Castle', due: '2026-10-17T12:01:00Z', stop: 'Stop W' },
          { route: '12', destination: 'Oxford Circus', due: '2026-10-17T12:05:00Z', stop: 'Stop W' }
        ]
      }
    ]);
  });

  it("gives a stop's platforms, and puts its trams and metro on the Tube card", () => {
    const majorstuen = fromServer(ANSWER, NOW)?.stops.find(stop => stop.name === 'Majorstuen');
    expect(majorstuen?.mode).toBe('tube');
    expect(majorstuen?.arrivals.map(arrival => arrival.stop)).toEqual(['Platform A', 'Platform 2']);
  });

  it('leaves out stops with nothing stored or read too long ago', () => {
    const [first, ...rest] = ANSWER.stops;
    const answer = {
      stops: [{ ...first, departures: null }, ...rest]
    } as DeviceArrivals;
    expect(fromServer(answer, NOW)?.stops.map(stop => stop.name)).not.toContain('Kennington');
    expect(fromServer(ANSWER, new Date('2026-10-17T12:06:00Z'))).toBeNull();
  });

  it('gives the mock answer the shape the Dashboard shows', () => {
    expect(fromServer(mockAnswer(NOW), NOW)?.stops.map(stop => stop.mode)).toEqual(['tube', 'bus']);
  });
});

describe('reading the departures from countdown-server', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    config.serverClient.mockReset();
    forgetArrivals();
  });

  it('asks GET /api/devices/arrivals with the device secret', async () => {
    config.serverClient.mockReturnValue({ baseUrl: 'https://api.countdown.build', secret: 'device-secret' });
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(Response.json(ANSWER)));
    vi.stubGlobal('fetch', fetch);
    const arrivals = await readArrivals(NOW);
    expect(arrivals?.stops.length).toBeGreaterThan(0);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url instanceof Request ? url.url : url)).toBe('https://api.countdown.build/api/devices/arrivals');
    expect(new Headers(url instanceof Request ? url.headers : init?.headers).get('Authorization')).toBe(
      'Bearer device-secret'
    );
  });

  it('gives the last answer again when a read fails, and nothing before the first', async () => {
    config.serverClient.mockReturnValue({ baseUrl: 'https://api.countdown.build', secret: 'device-secret' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({}, { status: 503 })))
    );
    expect(await readArrivals(NOW)).toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json(ANSWER)))
    );
    await readArrivals(NOW);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    );
    const kept = await readArrivals(NOW);
    expect(kept?.updatedAt).toBe('2026-10-17T12:00:00Z');
  });

  it('reads nothing when the kiosk is not registered', async () => {
    config.serverClient.mockReturnValue(null);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await readArrivals(NOW)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
