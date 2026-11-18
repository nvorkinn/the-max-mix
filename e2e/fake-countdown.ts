// cspell:ignore GZZLUEAC GZZLUBOR GZZLULBN
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
export const FEED = `${API}/api/devices/feed`;

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
  config: object | null,
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
  // The notices (GET /api/devices/notices) and the live feed: refused, as for a secret the server doesn't know, unless a
  // test calls fakeFeed.
  await Promise.all(
    [NOTICES, FEED].map(url =>
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
  await page.route(ARRIVALS, route => {
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
 * An owned kiosk's config with the stops fakeFeed answers for and the London postcode its notices are for, in the
 * app's default look (or night's).
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

const hoursFrom = (now: Date, hours: number) => new Date(now.getTime() + hours * 3_600_000);
const localHour = (time: Date) => time.toISOString().slice(0, 13);

/**
 * London's weather as countdown-server keeps it (Open-Meteo's answer, in London's local time, which is UTC in November),
 * read five minutes before `now`: partly cloudy and 9° now, rain from two hours on for two hours, then cloud, a week of
 * days with a wet Sunday.
 */
function weatherAt(now: Date) {
  const midnight = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const days = Array.from({ length: 7 }, (_, day) =>
    hoursFrom(midnight, day * 24)
      .toISOString()
      .slice(0, 10)
  );
  const hours = Array.from({ length: 7 * 24 }, (_, hour) => hoursFrom(midnight, hour));
  const rain = new Set([2, 3].map(hour => localHour(hoursFrom(now, hour))));
  const read = new Date(now.getTime() - 5 * 60_000);
  return {
    location: 'London',
    key: 'london-gb-2643743',
    background: null,
    forecast: {
      fetched_at: read.toISOString(),
      location: 'london-gb-2643743',
      forecast: {
        utc_offset_seconds: 0,
        current: { time: read.toISOString().slice(0, 16), temperature: 9.2, weather_code: 2, is_day: true },
        current_units: { temperature: '°C' },
        hourly: {
          time: hours.map(hour => `${localHour(hour)}:00`),
          temperature: hours.map(hour => (hour.getUTCHours() >= 8 && hour.getUTCHours() < 17 ? 11 : 7)),
          weather_code: hours.map(hour => (rain.has(localHour(hour)) ? 61 : 3))
        },
        daily: {
          time: days,
          temperature_max: days.map((_, index) => 11 + (index % 3)),
          temperature_min: days.map(() => 5),
          weather_code: days.map(day => (new Date(`${day}T12:00:00Z`).getUTCDay() === 0 ? 63 : 3)),
          sunrise: days.map(day => `${day}T07:12`),
          sunset: days.map(day => `${day}T16:08`)
        }
      }
    }
  };
}

/** Names longer than the boards have room for, to show they never push the layout about. */
const LONG = {
  station: 'Elephant & Castle Underground Station (Northern and Bakerloo lines, Elephant & Castle Shopping Centre)',
  tube: "Harrow & Wealdstone via Queen's Park, Willesden Junction and Stonebridge Park",
  bus: 'Oxford Circus, Regent Street, John Lewis and the West End via Trafalgar Square'
};

/**
 * The kiosk's departures (countdown-api's DeviceArrivals) read at `now` and timed from it: a Tube station's trains on
 * their platforms and a bus stop's buses, each with its vehicle, or with names far too long for the boards.
 */
function arrivalsAt(now: Date, hasLongNames: boolean) {
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();
  const departure = (vehicle: string, line: string, destination: string, minutes: number, platform: string | null) => ({
    vehicle_id: vehicle,
    line,
    destination,
    expected_at: at(minutes),
    platform,
    mode: null
  });
  const stop = (id: string, name: string, mode: string, letter: string | null, departures: object[]) => ({
    source: 'tfl',
    id,
    departures: { fetched_at: now.toISOString(), stop_id: id, name, mode, stop_letter: letter, modes: [], departures }
  });
  return {
    stops: [
      stop('940GZZLUEAC', hasLongNames ? LONG.station : 'Elephant & Castle Underground Station', 'tube', null, [
        departure('031', 'Northern', 'High Barnet', 3, 'Northbound - Platform 1'),
        departure('057', 'Northern', 'Morden', 7, 'Southbound - Platform 2'),
        departure('212', 'Bakerloo', hasLongNames ? LONG.tube : 'Harrow & Wealdstone', 9, 'Northbound - Platform 3')
      ]),
      stop('490000077E', 'Elephant & Castle', 'bus', 'E', [
        departure('LX11AVC', '12', hasLongNames ? LONG.bus : 'Oxford Circus', 2, null),
        departure('LTZ1234', '343', 'New Cross', 6, null),
        departure('LX11AVD', '12', 'Oxford Circus', 11, null)
      ])
    ]
  };
}

/** Tube stations and bus stops near Elephant & Castle, each with four departures, for a kiosk with more stops. */
const NEARBY = [
  ['940GZZLUEAC', 'Elephant & Castle Underground Station', 'tube', ['Northern', 'Bakerloo']],
  ['940GZZLUKNG', 'Kennington Underground Station', 'tube', ['Northern', 'Northern']],
  ['490000077E', 'Elephant & Castle', 'bus', ['12', '343']],
  ['940GZZLUBOR', 'Borough Underground Station', 'tube', ['Northern', 'Northern']],
  ['940GZZLULBN', 'Lambeth North Underground Station', 'tube', ['Bakerloo', 'Bakerloo']],
  ['490000077F', 'Elephant & Castle', 'bus', ['35', '40']]
] as const;

/** The arrivals of a kiosk with the first `count` of NEARBY's stops, read at `now`. */
export function stationsAt(now: Date, count: number) {
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();
  const destinations = ['Morden', 'High Barnet', 'Harrow & Wealdstone', 'Oxford Circus'];
  return {
    stops: NEARBY.slice(0, count).map(([id, name, mode, lines], stop) => ({
      source: 'tfl',
      id,
      departures: {
        fetched_at: now.toISOString(),
        stop_id: id,
        name,
        mode,
        stop_letter: mode === 'bus' ? id.slice(-1) : null,
        modes: [],
        departures: [0, 1, 2, 3].map(index => ({
          vehicle_id: `${id}-${index}`,
          line: lines[index % 2],
          destination: destinations[(index + stop) % destinations.length],
          expected_at: at(2 + stop + index * 4),
          platform: mode === 'bus' ? null : `Northbound - Platform ${index + 1}`,
          mode: null
        }))
      }
    }))
  };
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

/** A line of the network as TfL's line status answers it. */
const line = (id: string, name: string, status = 'Good Service', reason?: string) => ({
  id,
  name,
  modeName: id === 'elizabeth' ? 'elizabeth-line' : 'tube',
  lineStatuses: [{ statusSeverityDescription: status, ...(reason && { reason }), validityPeriods: [] }]
});

/** Every Tube line and the Elizabeth line as TfL's /Line/Mode/tube,elizabeth-line/Status answers them at `now`. */
function tflNetworkAt(now: Date) {
  return {
    fetched_at: now.toISOString(),
    lines: [
      line('bakerloo', 'Bakerloo'),
      line('central', 'Central', 'Minor Delays', 'Central Line: Minor delays due to an earlier signal failure.'),
      line('circle', 'Circle'),
      line('district', 'District', 'Part Closure', "DISTRICT LINE: No service between Earl's Court and Wimbledon."),
      line('elizabeth', 'Elizabeth line'),
      line('hammersmith-city', 'Hammersmith & City'),
      line('jubilee', 'Jubilee'),
      line('metropolitan', 'Metropolitan'),
      line('northern', 'Northern'),
      line('piccadilly', 'Piccadilly'),
      line('victoria', 'Victoria'),
      line('waterloo-city', 'Waterloo & City', 'Service Closed')
    ]
  };
}

/**
 * The kiosk's notices (countdown-api's DeviceNotices) for a London postcode, read at `now`: a Tube line with severe
 * delays (and a model's short form of TfL's reason), one part closed and a weather warning; with `isQuiet`, nothing to
 * report. Either way, the
 * Tube's status, which the Dashboard shows when there are no notices.
 */
function noticesAt(now: Date, isQuiet: boolean) {
  const fetchedAt = now.toISOString();
  const at = (hours: number) => hoursFrom(now, hours).toISOString();
  const delays =
    'NORTHERN LINE: Severe delays between Morden and Kennington while we fix a signal failure at Clapham Common. ' +
    'GOOD SERVICE on the rest of the line.';
  return {
    postcode: 'SE17 3LL',
    country: 'GB',
    tfl_stops: isQuiet
      ? []
      : [
          {
            stop_id: '940GZZLUEAC',
            lines: {
              fetched_at: fetchedAt,
              stop_id: '940GZZLUEAC',
              lines: [
                tubeLine('northern', 'Severe Delays', delays),
                tubeLine(
                  'victoria',
                  'Part Closure',
                  'VICTORIA LINE: No service between Euston and Walthamstow Central while we carry out track ' +
                    'renewal works. Replacement buses operate.',
                  [{ fromDate: at(-24), toDate: at(48) }]
                )
              ],
              shorts: [
                {
                  text: delays,
                  title: 'Delays, Morden to Kennington',
                  summary: 'Morden to Kennington, signal failure at Clapham Common'
                }
              ]
            },
            stations: null
          }
        ],
    tfl_roads: null,
    met_office: isQuiet
      ? null
      : {
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
    bank_holidays: null,
    tfl_network: tflNetworkAt(now)
  };
}

/** One server-sent event. */
const message = (event: string, data: object) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

interface FeedOptions {
  /** Names too long for the boards. */
  long?: boolean;
  /** Nothing on the notice board. */
  none?: boolean;
  /** The departures each stream sends instead (countdown-api's DeviceArrivals), asked as each opens. */
  arrivals?: () => object;
  /** The wait before the next stream that each stream asks for. */
  retryMs?: number;
}

/**
 * Stands in for countdown-server's live feed (GET /api/devices/feed, countdown-api's getFeed) for an owned kiosk: each
 * stream sends the weather, departures and notices as read at `now` (the page's fixed clock) and then ends, as the
 * server's do; its `retry` keeps the next one a minute off unless `retryMs` says otherwise.
 */
export async function fakeFeed(page: Page, now: Date, options: FeedOptions = {}) {
  const { long = false, none = false, arrivals = () => arrivalsAt(now, long), retryMs = 60_000 } = options;
  await page.route(FEED, route => {
    const cors = corsFor(route.request().headers()['origin']);
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const events = [
      message('weather', weatherAt(now)),
      message('arrivals', arrivals()),
      message('notices', noticesAt(now, none))
    ];
    return route.fulfill({
      status: 200,
      headers: { ...cors, 'Cache-Control': 'no-store' },
      contentType: 'text/event-stream',
      body: `retry: ${String(retryMs)}\n\n${events.join('')}`
    });
  });
}
