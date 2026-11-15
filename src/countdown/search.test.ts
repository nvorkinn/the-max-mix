import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../vendor/countdown-api/src/countdown_api/fixtures/search.json';
import touchscreen from '../../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json';
import * as registration from './registration';
import { SearchFailed, describeStop, rememberStop, searchPlaces, searchStops } from './search';

const SECRET = touchscreen.registration.secret;

function register() {
  vi.spyOn(registration, 'deviceCredentials').mockReturnValue({ deviceId: touchscreen.device_id, secret: SECRET });
}

function answer(status: number, body?: unknown) {
  const fetch = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
      })
    )
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv('VITE_COUNTDOWN_API', 'https://api.countdown.build');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('searchStops', () => {
  it("asks the screens' API with the device secret, and lists stations with their platforms under them", async () => {
    register();
    const fetch = answer(200, fixture.stops);
    const results = await searchStops(fixture.stops_query);
    const [input, init] = fetch.mock.calls[0] ?? [''];
    const request = new Request(input, init);
    expect(request.url).toBe('https://api.countdown.build/api/stops/search?q=oslo+s');
    expect(request.headers.get('Authorization')).toBe(`Bearer ${SECRET}`);
    expect(results.map(({ key, name, indent }) => ({ key, name, indent }))).toEqual([
      { key: 'entur:NSR:StopPlace:337', name: 'Oslo S', indent: false },
      { key: 'entur:NSR:Quay:7333', name: 'Oslo S', indent: true },
      { key: 'tfl:490000077E', name: 'Oval Station', indent: false }
    ]);
    expect(results[1]?.value).toEqual({ source: 'entur', id: 'NSR:Quay:7333' });
  });

  it("fails when the kiosk isn't registered, or the server refuses or can't be reached", async () => {
    const fetch = answer(200, fixture.stops);
    await expect(searchStops('oslo')).rejects.toBeInstanceOf(SearchFailed);
    expect(fetch).not.toHaveBeenCalled();
    register();
    answer(401, { error: 'unknown secret' });
    await expect(searchStops('oslo')).rejects.toBeInstanceOf(SearchFailed);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    );
    await expect(searchStops('oslo')).rejects.toBeInstanceOf(SearchFailed);
  });
});

describe('searchPlaces', () => {
  it('finds places, each with the weather section picking it saves', async () => {
    register();
    const fetch = answer(200, fixture.places);
    const [place] = await searchPlaces('oslo');
    expect(new Request(...(fetch.mock.calls[0] ?? [''])).url).toBe(
      'https://api.countdown.build/api/places/search?q=oslo'
    );
    expect(place).toMatchObject({
      name: 'Oslo',
      detail: 'Norway',
      value: { location: 'Oslo', key: 'oslo-no-3143244' }
    });
  });
});

describe('describeStop', () => {
  it("names a stop this kiosk added, and otherwise shows the stop's id", async () => {
    register();
    answer(200, fixture.stops);
    const [station] = await searchStops('oslo s');
    expect(describeStop({ source: 'entur', id: 'NSR:StopPlace:337' })).toEqual({
      name: 'NSR:StopPlace:337',
      detail: 'Entur'
    });
    if (station) rememberStop(station);
    expect(describeStop({ source: 'entur', id: 'NSR:StopPlace:337' })).toEqual({
      name: 'Oslo S',
      detail: 'Train & Metro • All platforms • L1, R10, 1, 2 (+12 more) · Entur'
    });
  });
});
