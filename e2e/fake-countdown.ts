import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

const fixture = JSON.parse(
  readFileSync(new URL('../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json', import.meta.url), 'utf8')
) as { config: object };

const search = JSON.parse(
  readFileSync(new URL('../vendor/countdown-api/src/countdown_api/fixtures/search.json', import.meta.url), 'utf8')
) as { stops_query: string; stops: object[]; places_query: string; places: object[] };

// countdown-server's screens' API, as the build names it (.env.production).
const API = 'https://api.countdown.build';
export const CONFIG = `${API}/api/devices/config`;

/**
 * countdown-api's example config, once someone owns the kiosk. Before that there's none: a touchscreen registers through
 * its owner's sign-in, so the server doesn't know an unowned kiosk's secret.
 */
export const DEVICE_CONFIGS = { owned: fixture.config };

const at = (hour: number) => `2026-11-15T${String(hour).padStart(2, '0')}:00`;
// What each hour of 15 November brings: [temperature, WMO code]; cloudy at 8° but for the morning the screenshots show.
const HOURS = new Map([
  [10, [9, 2]],
  [11, [10, 3]],
  [12, [11, 3]],
  [13, [11, 61]],
  [14, [10, 61]],
  [15, [9, 3]]
]);

/**
 * The weather the fake server keeps for London on 15 November: partly cloudy and 9° at 09:15, then cloud and rain, as
 * Open-Meteo answers it (times in London's local time, which is UTC in November). Fresh for the screenshots, which fix
 * the time at 09:20; days old for every other test.
 */
const WEATHER = {
  location: 'London',
  key: 'london-gb-2643743',
  forecast: {
    fetched_at: '2026-11-15T09:15:00Z',
    location: 'london-gb-2643743',
    forecast: {
      utc_offset_seconds: 0,
      current: { time: '2026-11-15T09:15', temperature: 9.2, weather_code: 2, is_day: true },
      current_units: { temperature: '°C' },
      hourly: {
        time: Array.from({ length: 24 }, (_, hour) => at(hour)),
        temperature: Array.from({ length: 24 }, (_, hour) => HOURS.get(hour)?.[0] ?? 8),
        weather_code: Array.from({ length: 24 }, (_, hour) => HOURS.get(hour)?.[1] ?? 3)
      },
      daily: {
        time: ['2026-11-15'],
        temperature_max: [12.4],
        temperature_min: [5.8],
        sunrise: ['2026-11-15T07:12'],
        sunset: ['2026-11-15T16:08']
      }
    }
  }
};

/** The CORS headers the real server sends the app's origin on its screens' API. */
function corsFor(origin = '*') {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match',
    'Access-Control-Allow-Methods': 'GET, PUT',
    'Access-Control-Expose-Headers': 'ETag'
  };
}

/**
 * Stands in for countdown-server's config routes, which the app asks at start and each time the Settings tab opens (the
 * tests start registered: see playwright.config.ts). Answers 401, as for a secret it doesn't know, unless a test gives a
 * config, and the CORS headers the real server sends the app's origin. The config has a version (its ETag), which each
 * save changes. A save of a section (PUT /api/devices/config/{section}) with the version as If-Match is answered with the
 * whole config, the section replaced; one with an older version is a 409; and every save is `saveStatus` with no body
 * when a test gives one. Returns the Authorization header of each request and the whole config each save made.
 */
export async function fakeCountdownServer(
  page: Page,
  config: object | null = null,
  { saveStatus }: { saveStatus?: number } = {}
) {
  const authorizations: string[] = [];
  const saves: Record<string, unknown>[] = [];
  let current = config as Record<string, unknown> | null;
  let version = 1;
  const etag = () => `"v${version}"`;
  await page.route(CONFIG, route => {
    const request = route.request();
    const cors = corsFor(request.headers()['origin']);
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    authorizations.push(request.headers()['authorization'] ?? '');
    return route.fulfill(
      current === null
        ? { status: 401, headers: cors }
        : {
            status: 200,
            headers: { ...cors, ETag: etag() },
            contentType: 'application/json',
            body: JSON.stringify(current)
          }
    );
  });
  await page.route(`${CONFIG}/*`, route => {
    const request = route.request();
    const cors = corsFor(request.headers()['origin']);
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    authorizations.push(request.headers()['authorization'] ?? '');
    if (current === null) return route.fulfill({ status: 401, headers: cors });
    if (saveStatus !== undefined) return route.fulfill({ status: saveStatus, headers: cors });
    if (request.headers()['if-match'] !== etag()) return route.fulfill({ status: 409, headers: cors });
    const section = new URL(request.url()).pathname.split('/').at(-1) ?? '';
    current = { ...current, [section]: request.postDataJSON() as unknown };
    version += 1;
    saves.push(current);
    return route.fulfill({
      status: 200,
      headers: { ...cors, ETag: etag() },
      contentType: 'application/json',
      body: JSON.stringify(current)
    });
  });
  // The weather is the same whether or not someone owns the kiosk, as the Dashboard's made-up weather was.
  await page.route(`${API}/api/devices/weather`, route => {
    const request = route.request();
    const cors = corsFor(request.headers()['origin']);
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({
      status: 200,
      headers: cors,
      contentType: 'application/json',
      body: JSON.stringify(WEATHER)
    });
  });
  // The searches answer countdown-api's example: its stops for "oslo s", its places for "oslo", and nothing else.
  const searches = [
    ['/api/stops/search', search.stops_query, search.stops],
    ['/api/places/search', search.places_query, search.places]
  ] as const;
  await Promise.all(
    searches.map(([path, query, results]) =>
      page.route(`${API}${path}?*`, route => {
        const request = route.request();
        const cors = {
          'Access-Control-Allow-Origin': request.headers()['origin'] ?? '*',
          'Access-Control-Allow-Headers': 'Authorization'
        };
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        const asked = new URL(request.url()).searchParams.get('q');
        return route.fulfill({
          status: 200,
          headers: cors,
          contentType: 'application/json',
          body: JSON.stringify(asked === query ? results : [])
        });
      })
    )
  );
  return { authorizations, saves };
}
