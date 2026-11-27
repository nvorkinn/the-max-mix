// cspell:ignore Drammen
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../vendor/countdown-api/src/countdown_api/fixtures/search.json';
import locate from '../../../vendor/countdown-api/src/countdown_api/fixtures/locate.json';
import touchscreen from '../../../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json';
import panels from '../../../vendor/countdown-api/src/countdown_api/fixtures/device_panels.json';
import * as registration from './registration';
import {
  SearchFailed,
  describeStop,
  learnStopNames,
  locatePlace,
  nearbyStops,
  rememberStop,
  searchPlaces,
  searchStops
} from './search';

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

  it('gives a London bus stop its letter, for its disc, and only its routes under it', async () => {
    register();
    answer(200, fixture.stops);
    const results = await searchStops(fixture.stops_query);
    expect(results.map(({ letter, detail }) => ({ letter, detail }))).toEqual([
      { letter: undefined, detail: 'Train & Metro • All platforms • L1, R10, 1, 2 (+12 more)' },
      { letter: undefined, detail: 'Platform 4 • towards Drammen • L1' },
      { letter: 'E', detail: '36, 185, 436' }
    ]);
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

function browserAt(position: { latitude: number; longitude: number } | null) {
  const getCurrentPosition = vi.fn<Geolocation['getCurrentPosition']>((found, failed) => {
    if (position) found({ coords: position } as GeolocationPosition);
    else failed?.({ code: 2 } as GeolocationPositionError);
  });
  // jsdom has no geolocation: a navigator like its own, with one.
  vi.stubGlobal(
    'navigator',
    Object.assign(Object.create(navigator) as Navigator, { geolocation: { getCurrentPosition } })
  );
  return getCurrentPosition;
}

describe('locatePlace', () => {
  it("asks for the place at the browser's position", async () => {
    register();
    browserAt(fixture.here_query);
    const fetch = answer(200, fixture.here);
    const place = await locatePlace();
    expect(new Request(...(fetch.mock.calls[0] ?? [''])).url).toBe(
      'https://api.countdown.build/api/places/here?latitude=59.9139&longitude=10.7522'
    );
    expect(place).toMatchObject({ name: 'Oslo', value: { location: 'Oslo', key: 'oslo-no-3143244' } });
  });

  it('lets the server place the kiosk by its IP when the browser has no position', async () => {
    register();
    browserAt(null);
    const fetch = answer(200, fixture.here);
    await locatePlace();
    expect(new Request(...(fetch.mock.calls[0] ?? [''])).url).toBe('https://api.countdown.build/api/places/here');
  });

  it('asks for the place at a position it is given, not where the browser is', async () => {
    register();
    const getCurrentPosition = browserAt(fixture.here_query);
    const fetch = answer(200, fixture.here);
    await locatePlace(locate.near_query);
    expect(new Request(...(fetch.mock.calls[0] ?? [''])).url).toBe(
      'https://api.countdown.build/api/places/here?latitude=51.484787&longitude=-0.091724'
    );
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('is null when there is no telling, and rejects when the server refuses', async () => {
    register();
    browserAt(null);
    answer(200, []);
    await expect(locatePlace()).resolves.toBeNull();
    answer(502, []);
    await expect(locatePlace()).rejects.toBeInstanceOf(SearchFailed);
  });
});

describe('nearbyStops', () => {
  it('asks for the stops near a position, nearest first, each with its letter, lines and distance', async () => {
    register();
    const fetch = answer(200, locate.stops_near);
    const stops = await nearbyStops(locate.near_query);
    const request = new Request(...(fetch.mock.calls[0] ?? ['']));
    expect(request.url).toBe('https://api.countdown.build/api/stops/near?latitude=51.484787&longitude=-0.091724');
    expect(request.headers.get('Authorization')).toBe(`Bearer ${SECRET}`);
    expect(stops[0]).toEqual({
      key: 'tfl:490014501K',
      name: 'Westmoreland Road',
      detail: '40, 68, 176, 468, N68',
      letter: 'K',
      indent: false,
      value: { source: 'tfl', id: '490014501K' },
      distance: 136
    });
    expect(stops.at(-1)).toMatchObject({ name: 'Elephant & Castle Underground Station', detail: 'Bakerloo, Northern' });
  });

  it("fails when the kiosk isn't registered, or the server can't search", async () => {
    const fetch = answer(200, locate.stops_near);
    await expect(nearbyStops(locate.near_query)).rejects.toBeInstanceOf(SearchFailed);
    expect(fetch).not.toHaveBeenCalled();
    register();
    answer(502, []);
    await expect(nearbyStops(locate.near_query)).rejects.toBeInstanceOf(SearchFailed);
  });
});

describe('a build that mocks the server', () => {
  it("searches countdown-api's example answers, asking nothing of the server", async () => {
    vi.stubEnv('VITE_COUNTDOWN_CONFIG', 'mock');
    const fetch = answer(500);
    const stops = await searchStops('anything');
    const places = await searchPlaces('anything');
    expect(stops.map(result => result.name)).toEqual(['Oslo S', 'Oslo S', 'Oval Station']);
    expect(places.map(result => result.value)).toEqual([{ location: 'Oslo', key: 'oslo-no-3143244' }]);
    const here = await locatePlace();
    expect(here?.value).toEqual({ location: 'Oslo', key: 'oslo-no-3143244' });
    const near = await nearbyStops(locate.near_query);
    expect(near.map(stop => stop.key)).toEqual(locate.stops_near.map(stop => `tfl:${stop.id}`));
    expect(fetch).not.toHaveBeenCalled();
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

  it('shows the id when the names kept are unreadable, or storage is unavailable', () => {
    localStorage.setItem('maxmix.savedStops', '{');
    expect(describeStop({ source: 'tfl', id: '490000077E' })).toEqual({ name: '490000077E', detail: 'TfL' });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded');
    });
    rememberStop({
      key: 'tfl:490000077E',
      name: 'Oval Station',
      detail: '',
      indent: false,
      value: { source: 'tfl', id: '490000077E' }
    });
    expect(describeStop({ source: 'tfl', id: '490000077E' }).name).toBe('490000077E');
  });
});

describe('learnStopNames', () => {
  it("keeps the names of stops it doesn't know from their departures, and leaves the ones it knows", async () => {
    register();
    rememberStop({
      key: 'tfl:490000123W',
      name: 'Elephant & Castle',
      detail: '12, 35',
      letter: 'W',
      indent: false,
      value: { source: 'tfl', id: '490000123W' }
    });
    const fetch = answer(200, panels.arrivals);
    await expect(learnStopNames()).resolves.toBe(true);
    const [input, init] = fetch.mock.calls[0] ?? [''];
    expect(new Request(input, init).url).toBe('https://api.countdown.build/api/devices/arrivals');
    expect(describeStop({ source: 'tfl', id: '940GZZLUKNG' })).toEqual({
      name: 'Kennington Underground Station',
      detail: 'TfL'
    });
    expect(describeStop({ source: 'tfl', id: '490000123W' })).toEqual({
      name: 'Elephant & Castle',
      detail: '12, 35 · TfL',
      letter: 'W'
    });
    await expect(learnStopNames()).resolves.toBe(false);
  });

  it('learns nothing when the kiosk is not registered or the server refuses', async () => {
    const fetch = answer(500);
    await expect(learnStopNames()).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    register();
    await expect(learnStopNames()).resolves.toBe(false);
  });
});
