import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import locate from '../../../vendor/countdown-api/src/countdown_api/fixtures/locate.json';
import touchscreen from '../../../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json';
import {
  SETUP_LOCATION_MAX_AGE_MS,
  findPostcode,
  keepSetupLocation,
  keptSetupLocation,
  locateKiosk,
  metresBetween,
  scanAccessPoints
} from './location';
import * as registration from './registration';

const SECRET = touchscreen.registration.secret;
const SCAN = 'http://127.0.0.1:7341/location/scan';
const LOCATE = 'https://api.countdown.build/api/devices/locate';

/** What the Pi's service answers for the access points in countdown-api's example request. */
const ACCESS_POINTS = locate.locate_request.wifi_access_points.map(point => ({
  macAddress: point.mac_address,
  signalStrength: point.signal_strength,
  ...(point.channel !== undefined && { channel: point.channel }),
  ...(point.age !== undefined && { age: point.age })
}));

function register() {
  vi.spyOn(registration, 'deviceCredentials').mockReturnValue({ deviceId: touchscreen.device_id, secret: SECRET });
}

type Answer = 'unreachable' | { status: number; body?: unknown };

/** Answers each URL as given, and anything else 404; returns the fetch, to see what was asked. */
function answers(byUrl: Record<string, Answer>) {
  const fetch = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>((input, init) => {
    const { url } = new Request(input, init);
    const answer = byUrl[url.split('?', 1)[0] ?? ''] ?? { status: 404 };
    if (answer === 'unreachable') return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve(
      new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'Content-Type': 'application/json' }
      })
    );
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const asked = (fetch: ReturnType<typeof answers>, index: number) => new Request(...(fetch.mock.calls[index] ?? ['']));

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv('VITE_COUNTDOWN_API', 'https://api.countdown.build');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('scanAccessPoints', () => {
  it("gives the Pi's access points as the server takes them", async () => {
    answers({ [SCAN]: { status: 200, body: { accessPoints: [...ACCESS_POINTS, { macAddress: 'no signal' }] } } });
    await expect(scanAccessPoints()).resolves.toEqual(locate.locate_request.wifi_access_points);
  });

  it("is null when the Pi can't scan, or isn't there", async () => {
    answers({ [SCAN]: { status: 503, body: { error: 'no Wi-Fi' } } });
    await expect(scanAccessPoints()).resolves.toBeNull();
    answers({ [SCAN]: { status: 200, body: {} } });
    await expect(scanAccessPoints()).resolves.toBeNull();
    answers({ [SCAN]: 'unreachable' });
    await expect(scanAccessPoints()).resolves.toBeNull();
  });
});

describe('locateKiosk', () => {
  it('sends what the Pi sees to the server with the device secret, and gives its answer', async () => {
    register();
    const fetch = answers({
      [SCAN]: { status: 200, body: { accessPoints: ACCESS_POINTS } },
      [LOCATE]: { status: 200, body: locate.locate }
    });
    await expect(locateKiosk()).resolves.toEqual(locate.locate);
    const request = asked(fetch, 1);
    expect(request.url).toBe(LOCATE);
    expect(request.method).toBe('POST');
    expect(request.headers.get('Authorization')).toBe(`Bearer ${SECRET}`);
    expect(await request.json()).toEqual(locate.locate_request);
  });

  it('sends the strongest 30 at most', async () => {
    register();
    const many = Array.from({ length: 35 }, (_, index) => ({
      macAddress: `aa:bb:cc:dd:ee:${index.toString(16).padStart(2, '0')}`,
      signalStrength: -40 - index
    }));
    const fetch = answers({
      [SCAN]: { status: 200, body: { accessPoints: many } },
      [LOCATE]: { status: 200, body: locate.locate }
    });
    await locateKiosk();
    const body = (await asked(fetch, 1).json()) as { wifi_access_points: unknown[] };
    expect(body.wifi_access_points).toHaveLength(30);
  });

  it('asks nothing of the server before the kiosk is registered, or when the Pi sees too little', async () => {
    const fetch = answers({ [SCAN]: { status: 200, body: { accessPoints: ACCESS_POINTS } } });
    await expect(locateKiosk()).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    register();
    answers({ [SCAN]: { status: 200, body: { accessPoints: ACCESS_POINTS.slice(0, 1) } } });
    await expect(locateKiosk()).resolves.toBeNull();
  });

  it.each([404, 429, 502, 503])('is null when the server answers %i', async status => {
    register();
    answers({
      [SCAN]: { status: 200, body: { accessPoints: ACCESS_POINTS } },
      [LOCATE]: { status, body: { error: 'no' } }
    });
    await expect(locateKiosk()).resolves.toBeNull();
  });

  it('is null when the server cannot be reached', async () => {
    register();
    answers({ [SCAN]: { status: 200, body: { accessPoints: ACCESS_POINTS } }, [LOCATE]: 'unreachable' });
    await expect(locateKiosk()).resolves.toBeNull();
  });
});

describe('findPostcode', () => {
  const LOOKUP = 'https://api.countdown.build/api/postcodes/lookup';

  it('gives where a postcode typed is', async () => {
    register();
    const fetch = answers({ [LOOKUP]: { status: 200, body: locate.postcode } });
    await expect(findPostcode('SE17 2PU')).resolves.toEqual(locate.near_query);
    expect(asked(fetch, 0).url).toBe(`${LOOKUP}?postcode=SE17+2PU`);
  });

  it("tells a postcode there's no such one from a server that can't say", async () => {
    register();
    answers({ [LOOKUP]: { status: 404, body: { error: 'unknown postcode' } } });
    await expect(findPostcode('ZZ1 1ZZ')).resolves.toBe('unknown');
    answers({ [LOOKUP]: { status: 502, body: { error: 'postcodes.io failed' } } });
    await expect(findPostcode('SE17 2PU')).resolves.toBe('failed');
    answers({ [LOOKUP]: 'unreachable' });
    await expect(findPostcode('SE17 2PU')).resolves.toBe('failed');
  });
});

describe('a build that mocks the server', () => {
  it("answers countdown-api's example, scanning and asking nothing", async () => {
    vi.stubEnv('VITE_COUNTDOWN_CONFIG', 'mock');
    const fetch = answers({});
    await expect(locateKiosk()).resolves.toEqual(locate.locate);
    await expect(findPostcode('anything')).resolves.toEqual(locate.near_query);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('metresBetween', () => {
  it('measures the distance between two positions', () => {
    // The fixture's position and its nearest postcode, which postcodes.io puts 16 m apart.
    expect(Math.round(metresBetween(locate.locate, locate.locate.postcodes[0] ?? locate.locate))).toBe(16);
    expect(metresBetween(locate.near_query, locate.near_query)).toBe(0);
  });
});

describe('the location kept during setup', () => {
  const found = { location: locate.locate as never, stops: [{ key: 'tfl:490014501K' }] };

  it('is kept for an hour', () => {
    keepSetupLocation(found, 1000);
    expect(keptSetupLocation(1000 + SETUP_LOCATION_MAX_AGE_MS - 1)).toEqual(found);
    expect(keptSetupLocation(1000 + SETUP_LOCATION_MAX_AGE_MS)).toBeNull();
    // A clock put back is no reason to trust it.
    expect(keptSetupLocation(999)).toBeNull();
  });

  it('keeps no stops when they could not be had', () => {
    keepSetupLocation({ location: locate.locate as never, stops: null }, 1000);
    expect(keptSetupLocation(1000)).toEqual({ location: locate.locate, stops: null });
  });

  it('is none when nothing readable is kept, or storage is unavailable', () => {
    expect(keptSetupLocation()).toBeNull();
    localStorage.setItem('maxmix.setupLocation', '{');
    expect(keptSetupLocation()).toBeNull();
    localStorage.setItem('maxmix.setupLocation', JSON.stringify({ foundAt: Date.now() }));
    expect(keptSetupLocation()).toBeNull();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded');
    });
    expect(() => keepSetupLocation(found)).not.toThrow();
  });
});
