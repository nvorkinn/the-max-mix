// cspell:ignore GZZLUEAC
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

const fixture = JSON.parse(
  readFileSync(new URL('../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json', import.meta.url), 'utf8')
) as { config: object };

const search = JSON.parse(
  readFileSync(new URL('../vendor/countdown-api/src/countdown_api/fixtures/search.json', import.meta.url), 'utf8')
) as { stops_query: string; stops: object[]; places_query: string; places: object[] };

const panels = JSON.parse(
  readFileSync(
    new URL('../vendor/countdown-api/src/countdown_api/fixtures/device_panels.json', import.meta.url),
    'utf8'
  )
) as { arrivals: object };

// countdown-server's screens' API, as the build names it (.env.production).
const API = 'https://api.countdown.build';
export const CONFIG = `${API}/api/devices/config`;
const ARRIVALS = `${API}/api/devices/arrivals`;
const NOTICES = `${API}/api/devices/notices`;

/**
 * countdown-api's example config, once someone owns the kiosk. Before that there's none: a touchscreen registers through
 * its owner's sign-in, so the server doesn't know an unowned kiosk's secret.
 */
export const DEVICE_CONFIGS = { owned: fixture.config };

const onTheHour = (hour: number) => `2026-11-15T${String(hour).padStart(2, '0')}:00`;
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
        time: Array.from({ length: 24 }, (_, hour) => onTheHour(hour)),
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
  // The departures and the notices (GET /api/devices/arrivals and /notices): refused, as for a secret the server doesn't
  // know, unless a test calls fakeArrivals or fakeNotices.
  await Promise.all(
    [ARRIVALS, NOTICES].map(url =>
      page.route(url, route => {
        const cors = corsFor(route.request().headers()['origin']);
        const isPreflight = route.request().method() === 'OPTIONS';
        return route.fulfill({ status: isPreflight ? 204 : 401, headers: cors });
      })
    )
  );
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
  // The device's arrivals: countdown-api's example, once someone owns the kiosk.
  await page.route(`${API}/api/devices/arrivals`, route => {
    const request = route.request();
    const cors = {
      'Access-Control-Allow-Origin': request.headers()['origin'] ?? '*',
      'Access-Control-Allow-Headers': 'Authorization'
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (current === null) return route.fulfill({ status: 401, headers: cors });
    return route.fulfill({
      status: 200,
      headers: cors,
      contentType: 'application/json',
      body: JSON.stringify(panels.arrivals)
    });
  });
  return { authorizations, saves };
}

/**
 * An owned kiosk's config with the stops fakeArrivals answers for and the London postcode fakeNotices answers for, in the
 * app's default look (or night's), so the Dashboard asks for its departures and notices and looks as it does unowned.
 */
export function dashboardConfig(skin: 'day' | 'night' = 'day') {
  return {
    ...fixture.config,
    style: { skin, colour: 'forest' },
    notice_board: { postcode: 'SE17 3LL', country: 'GB' },
    arrivals: {
      stops: [
        { source: 'tfl', id: '940GZZLUEAC' },
        { source: 'tfl', id: '490000077E' }
      ]
    }
  };
}

/**
 * Stands in for countdown-server's GET /api/devices/arrivals (countdown-api's getArrivals): a Tube station's trains and a
 * bus stop's buses, read at `now` (the page's fixed clock) and timed from it.
 */
export async function fakeArrivals(page: Page, now: Date) {
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();
  const departure = (line: string, destination: string, minutes: number) => ({
    line,
    destination,
    expected_at: at(minutes),
    platform: null,
    mode: null
  });
  const stop = (id: string, name: string, mode: string, letter: string | null, departures: object[]) => ({
    source: 'tfl',
    id,
    departures: { fetched_at: now.toISOString(), stop_id: id, name, mode, stop_letter: letter, modes: [], departures }
  });
  const answer = {
    stops: [
      stop('940GZZLUEAC', 'Elephant & Castle Underground Station', 'tube', null, [
        departure('Northern', 'High Barnet', 3),
        departure('Northern', 'Morden', 7),
        departure('Bakerloo', 'Harrow & Wealdstone', 9)
      ]),
      stop('490000077E', 'Elephant & Castle', 'bus', 'E', [
        departure('12', 'Oxford Circus', 2),
        departure('343', 'New Cross', 6),
        departure('12', 'Oxford Circus', 11)
      ])
    ]
  };
  await page.route(ARRIVALS, route => {
    const cors = corsFor(route.request().headers()['origin']);
    const isPreflight = route.request().method() === 'OPTIONS';
    return route.fulfill(isPreflight ? { status: 204, headers: cors } : { status: 200, headers: cors, json: answer });
  });
}

/** A Tube line as TfL's line status answers it. */
function tubeLine(id: string, status: string, reason: string, validityPeriods: object[] = []) {
  return {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    modeName: 'tube',
    lineStatuses: [{ statusSeverityDescription: status, reason, validityPeriods }]
  };
}

/**
 * Stands in for countdown-server's GET /api/devices/notices (countdown-api's getNotices): the providers' answers for a
 * London postcode, read at `now`: a Tube line with delays, one with a planned closure in three days and a weather warning.
 */
export async function fakeNotices(page: Page, now: Date) {
  const fetchedAt = now.toISOString();
  const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();
  const answer = {
    postcode: 'SE17 3LL',
    country: 'GB',
    tfl_stops: [
      {
        stop_id: '940GZZLUEAC',
        lines: {
          fetched_at: fetchedAt,
          stop_id: '940GZZLUEAC',
          lines: [
            tubeLine(
              'northern',
              'Minor Delays',
              'NORTHERN LINE: Minor delays between Morden and Kennington while we fix a signal failure at Clapham ' +
                'Common. GOOD SERVICE on the rest of the line.'
            ),
            tubeLine(
              'victoria',
              'Planned Closure',
              'VICTORIA LINE: No service between Euston and Walthamstow Central while we carry out track renewal ' +
                'works. Replacement buses operate.',
              [{ fromDate: at(72), toDate: at(120) }]
            )
          ]
        },
        stations: null
      }
    ],
    tfl_roads: null,
    met_office: {
      fetched_at: fetchedAt,
      postcode: 'SE17 3LL',
      region: 'se',
      items: [
        {
          title: 'Yellow warning of rain affecting London & South East England',
          description: 'Heavy and persistent rain may lead to some flooding and travel disruption.',
          link: '',
          pub_date: ''
        }
      ]
    },
    bank_holidays: null
  };
  await page.route(NOTICES, route => {
    const cors = corsFor(route.request().headers()['origin']);
    const isPreflight = route.request().method() === 'OPTIONS';
    return route.fulfill(isPreflight ? { status: 204, headers: cors } : { status: 200, headers: cors, json: answer });
  });
}
