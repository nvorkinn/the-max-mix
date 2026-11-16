// cspell:ignore HUBZEC
import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetArrivals, fromServer, mockAnswer, readArrivals } from './arrivals';
import type { ArrivalsResponse } from './arrivals';

const config = vi.hoisted(() => ({
  serverClient: vi.fn<() => { baseUrl: string; secret: string } | null>()
}));
vi.mock('../countdown/config', () => ({ serverClient: config.serverClient }));

const NOW = new Date('2026-11-15T09:00:00Z');
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

const HUB: ArrivalsResponse['stops'][number] = {
  source: 'tfl',
  id: 'HUBZEC',
  name: 'Elephant & Castle',
  fetched_at: at(-1),
  departures: [
    { mode: 'bus', line: '35', destination: 'Shoreditch', stop_letter: 'F', expected: at(4) },
    { mode: 'tube', line: 'Northern', destination: 'Morden', stop_letter: null, expected: at(3) },
    { mode: 'bus', line: '12', destination: 'Oxford Circus', stop_letter: 'E', expected: at(1) }
  ]
};

describe("countdown-server's departures as the Dashboard's", () => {
  it("splits a stop into its trains and its buses, soonest first, each bus with its stop's letter", () => {
    expect(fromServer({ stops: [HUB] }, NOW)).toEqual({
      updatedAt: at(-1),
      stops: [
        {
          name: 'Elephant & Castle',
          mode: 'tube',
          arrivals: [{ route: 'Northern', destination: 'Morden', due: at(3) }]
        },
        {
          name: 'Elephant & Castle',
          mode: 'bus',
          arrivals: [
            { route: '12', destination: 'Oxford Circus', due: at(1), stop: 'Stop E' },
            { route: '35', destination: 'Shoreditch', due: at(4), stop: 'Stop F' }
          ]
        }
      ]
    });
  });

  it('leaves out stops never read or read too long ago, and gives the oldest read of the rest', () => {
    const never = { ...HUB, id: 'never', fetched_at: null };
    const stale = { ...HUB, id: 'stale', fetched_at: at(-6) };
    const older = { ...HUB, id: 'older', fetched_at: at(-3) };
    expect(fromServer({ stops: [never, stale, HUB, older] }, NOW)?.updatedAt).toBe(at(-3));
    expect(fromServer({ stops: [never, stale] }, NOW)).toBeNull();
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
    const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(Response.json({ stops: [HUB] })));
    vi.stubGlobal('fetch', fetch);
    const arrivals = await readArrivals(NOW);
    expect(arrivals?.stops).toHaveLength(2);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toEqual(new URL('https://api.countdown.build/api/devices/arrivals'));
    expect(init?.headers).toEqual({ Authorization: 'Bearer device-secret' });
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
      vi.fn(() => Promise.resolve(Response.json({ stops: [HUB] })))
    );
    await readArrivals(NOW);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    );
    const kept = await readArrivals(NOW);
    expect(kept?.updatedAt).toBe(at(-1));
  });

  it('reads nothing when the kiosk is not registered', async () => {
    config.serverClient.mockReturnValue(null);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await readArrivals(NOW)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
