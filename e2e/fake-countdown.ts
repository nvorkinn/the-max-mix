// cspell:ignore GZZLUEAC GZZLUBOR GZZLULBN Effra Southwrk Lambeth TIMS
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

const fixture = JSON.parse(
  readFileSync(new URL('../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json', import.meta.url), 'utf8')
) as { config: { display: { quiet_hours: object } } };

const search = JSON.parse(
  readFileSync(new URL('../vendor/countdown-api/src/countdown_api/fixtures/search.json', import.meta.url), 'utf8')
) as { stops_query: string; stops: object[]; places_query: string; places: object[]; here: object[] };

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
const SOLOIST = `${API}/api/devices/soloist`;
const SPOTIFY_SIGN_INS = `${API}/api/devices/spotify/sign-ins`;
/** Where the fake server says Spotify sends the phone back to, which the kiosk sends again with the code. */
export const SPOTIFY_REDIRECT = 'https://app.countdown.build/spotify/sign-in/callback';
export const FEED = `${API}/api/devices/feed`;

/**
 * countdown-api's example config, once someone owns the kiosk (registration.spec.ts covers one nobody owns yet). Its
 * quiet hours are off here, so that no test's screen sleeps because of the hour it runs at.
 */
export const DEVICE_CONFIGS = {
  owned: {
    ...fixture.config,
    display: { ...fixture.config.display, quiet_hours: { ...fixture.config.display.quiet_hours, on: false } }
  }
};

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
 * The people's Soloist keys: none saved until a test adds some to the set it returns, a code for anyone (`codes` gets
 * who each was asked for), and a key forgotten when asked. Refused, as the config is, while nobody owns the kiosk. Never a key: the page never asks for one.
 */
async function fakeSoloistKeys(page: Page, isOwned: () => boolean, codes: string[]): Promise<Set<string>> {
  const soloistKeys = new Set<string>();
  await page.route(`${SOLOIST}/**`, route => {
    const request = route.request();
    const cors = { ...corsFor(request.headers()['origin']), 'Access-Control-Allow-Methods': 'GET, POST, DELETE' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (!isOwned()) return route.fulfill({ status: 401, headers: cors });
    const path = new URL(request.url()).pathname;
    if (path === '/api/devices/soloist/codes' && request.method() === 'POST') {
      codes.push((request.postDataJSON() as { person: string }).person);
      return route.fulfill({
        status: 201,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'a-soloist-key-code', expires_in: 600 })
      });
    }
    if (path === '/api/devices/soloist/keys' && request.method() === 'GET') {
      return route.fulfill({
        status: 200,
        headers: cors,
        contentType: 'application/json',
        body: JSON.stringify({ people: [...soloistKeys] })
      });
    }
    if (path.startsWith('/api/devices/soloist/keys/') && request.method() === 'DELETE') {
      const person = decodeURIComponent(path.replace('/api/devices/soloist/keys/', ''));
      return route.fulfill({ status: soloistKeys.delete(person) ? 204 : 404, headers: cors });
    }
    return route.fulfill({ status: 404, headers: cors });
  });
  return soloistKeys;
}

/**
 * The Spotify sign-ins the kiosk hands to phones: a new one each time it asks, waiting until a test has the phone come
 * back (`phoneComesBack`, for the newest one), then answered once. Answered whoever owns the kiosk, as the real server
 * answers any touchscreen. `started` is each request's body, so a test sees the challenge the kiosk sent. `make` is a
 * sign-in the server makes itself, as it does during a setup it follows (fakeSetup), with no request from the kiosk.
 */
async function fakeSpotifySignIns(page: Page) {
  /** What a phone that scanned the kiosk's code brings back from Spotify: its code, or its error. */
  type PhoneReply = { code: string } | { error: string };
  const started: Record<string, unknown>[] = [];
  const replies = new Map<string, PhoneReply | null>();
  let made = 0;
  let newest = '';
  const make = () => {
    made += 1;
    newest = String(made).padStart(32, '0');
    replies.set(newest, null);
    return { id: newest, redirect_uri: SPOTIFY_REDIRECT, expires_in: 600 };
  };
  await page.route(`${SPOTIFY_SIGN_INS}**`, route => {
    const request = route.request();
    const cors = { ...corsFor(request.headers()['origin']), 'Access-Control-Allow-Methods': 'GET, POST' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (request.method() === 'POST') {
      started.push(request.postDataJSON() as Record<string, unknown>);
      return route.fulfill({ status: 201, headers: cors, json: make() });
    }
    const id = new URL(request.url()).pathname.split('/').at(-1) ?? '';
    if (!replies.has(id)) return route.fulfill({ status: 404, headers: cors });
    const reply = replies.get(id);
    if (!reply) return route.fulfill({ status: 200, headers: cors, json: { status: 'waiting' } });
    replies.delete(id);
    return route.fulfill({
      status: 200,
      headers: cors,
      json: 'code' in reply ? { status: 'done', code: reply.code } : { status: 'failed', error: reply.error }
    });
  });
  return {
    started,
    make,
    phoneComesBack: (reply: PhoneReply) => {
      if (replies.has(newest)) replies.set(newest, reply);
    }
  };
}

/**
 * Stands in for countdown-server's config routes, which the app asks at start and each time the Settings tab opens (the
 * tests start registered: see playwright.config.ts). Answers 401, as for a secret it doesn't know, unless a test gives a
 * config, and the CORS headers the real server sends the app's origin. The config has a version (its ETag), which each
 * save changes. A save of a section (PUT /api/devices/config/{section}) with the version as If-Match is answered with the
 * whole config, the section replaced; one with an older version is a 409; and every save is `saveStatus` with no body
 * when a test gives one. Returns the Authorization header of each request, the whole config each save made, and the
 * people with a Soloist key saved, which a test may add to (and `soloistCodes`: who a key code was asked for), and the
 * Spotify sign-ins handed to phones. `change` is a change made elsewhere, as on the settings site: sections of the
 * config replaced, with a new version. The account route is refused too, unless the test has its own (`hasAccount`).
 */
export async function fakeCountdownServer(
  page: Page,
  config: object | null,
  { saveStatus, hasAccount = false }: { saveStatus?: number; hasAccount?: boolean } = {}
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
  // The owner's account (GET /api/devices/account), which the Parcels page asks about: refused, as for a secret the
  // server doesn't know, so no test waits on the real server for it. A test that fakes the route itself (`hasAccount`)
  // keeps its own.
  if (!hasAccount) {
    await page.route(`${API}/api/devices/account`, route => {
      const cors = corsFor(route.request().headers()['origin']);
      return route.fulfill({ status: route.request().method() === 'OPTIONS' ? 204 : 401, headers: cors });
    });
  }
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
  // The current location: countdown-api's example, wherever the browser is.
  await page.route(`${API}/api/places/here*`, route => {
    const request = route.request();
    const cors = {
      'Access-Control-Allow-Origin': request.headers()['origin'] ?? '*',
      'Access-Control-Allow-Headers': 'Authorization'
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({
      status: 200,
      headers: cors,
      contentType: 'application/json',
      body: JSON.stringify(search.here)
    });
  });
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
  const soloistCodes: string[] = [];
  const soloistKeys = await fakeSoloistKeys(page, () => current !== null, soloistCodes);
  const spotifySignIns = await fakeSpotifySignIns(page);
  const change = (sections: Record<string, unknown>) => {
    current = { ...current, ...sections };
    version += 1;
  };
  return { authorizations, saves, soloistKeys, soloistCodes, spotifySignIns, change };
}

/** What a touchscreen reports of its own setup (countdown-api's SetupReport). */
interface SetupReport {
  spotify?: { client_id: string; code_challenge: string; scope: string };
  soloist_device?: string;
  soloist_signed_in?: boolean;
  phone_paired?: boolean;
  finished?: boolean;
}

/**
 * Stands in for countdown-server's following of a touchscreen's setup (GET and PUT /api/devices/setup), which the
 * kiosk and its owner's phone both ask so they show the same step. As on the real server, a kiosk that has never
 * reported has no status (404), a report replaces only the fields it sends, and the step is the first not done:
 * `account` until someone owns the kiosk, `spotify` until a Soloist key code or key exists for it, `soloist_key`
 * until a key is saved, `soloist_sign_in` until the kiosk reports its Soloist signed in, `location` until the owner
 * saves or skips it on the phone, `presence` until the kiosk reports the phone paired, then `done` (at once when it
 * reports `finished`).
 *
 * `rest.server` is the rest of the fake server (fakeCountdownServer), once the test has made it: its Soloist keys and key
 * codes are what the step is read from, and its Spotify sign-ins are where the phone's sign-in is made. `phone` is
 * what the owner does on their phone, each a page of countdown-server's there. `reports` is every report the kiosk
 * sent.
 */
export async function fakeSetup(page: Page, rest: { server?: Awaited<ReturnType<typeof fakeCountdownServer>> }) {
  const server = () => rest.server;
  const reports: SetupReport[] = [];
  let reported: SetupReport | null = null;
  let isOwned = false;
  let isLocationDone = false;
  let signIn: { id: string; redirect_uri: string; expires_in: number } | undefined;
  const step = () => {
    if (reported?.finished) return 'done';
    if (!isOwned) return 'account';
    const keys = server()?.soloistKeys.size ?? 0;
    const codes = server()?.soloistCodes.length ?? 0;
    if (keys === 0 && codes === 0) return 'spotify';
    if (keys === 0) return 'soloist_key';
    if (!reported?.soloist_signed_in) return 'soloist_sign_in';
    if (!isLocationDone) return 'location';
    return reported.phone_paired ? 'done' : 'presence';
  };
  const status = () => ({
    step: step(),
    ...(step() === 'spotify' && signIn && { spotify_sign_in: signIn }),
    ...(reported?.soloist_device !== undefined && { soloist_device: reported.soloist_device })
  });
  await page.route(`${API}/api/devices/setup`, route => {
    const request = route.request();
    const cors = corsFor(request.headers()['origin']);
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (request.method() === 'PUT') {
      const report = request.postDataJSON() as SetupReport;
      reports.push(report);
      reported = { ...reported, ...report };
    }
    return route.fulfill(
      reported === null ? { status: 404, headers: cors } : { status: 200, headers: cors, json: status() }
    );
  });
  return {
    reports,
    step,
    phone: {
      /** Scans the kiosk's code and signs in to Countdown: the kiosk is theirs. */
      pair: () => {
        isOwned = true;
      },
      /** Is sent on to Spotify, with a sign-in the server makes from the challenge the kiosk reported. */
      goesToSpotify: () => {
        if (!reported?.spotify) throw new Error('The kiosk has reported no Spotify challenge to make a sign-in from.');
        signIn = server()?.spotifySignIns.make();
      },
      /** Comes back from Spotify with its code, or its error. */
      comesBackFromSpotify: (reply: { code: string } | { error: string }) => {
        server()?.spotifySignIns.phoneComesBack(reply);
      },
      /** Saves their Soloist key, on the page of the code the kiosk asked for. */
      savesKey: (person: string) => {
        server()?.soloistKeys.add(person);
      },
      /** Picks a postcode and stops on the Location pages, which the server saves to the kiosk's config. */
      savesLocation: (sections: Record<string, unknown>) => {
        server()?.change(sections);
        isLocationDone = true;
      },
      /** Taps Skip for now on the Location page. */
      skipsLocation: () => {
        isLocationDone = true;
      }
    }
  };
}

/**
 * An owned kiosk's config with the stops fakeFeed answers for and the London postcode its notices are for, in the
 * app's default colour.
 */
export function dashboardConfig() {
  return {
    ...fixture.config,
    style: { skin: 'night', colour: 'forest' },
    notice_board: { postcode: 'SE17 3LL', country: 'GB', address: null },
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
export function arrivalsAt(now: Date, hasLongNames: boolean) {
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

/**
 * The notices of a London kiosk whose board has the e-paper screens' other kinds (countdown-api's DeviceNotices, read at
 * `now`): a lift out at its Tube station, a road closed after a collision near it and the Environment Agency's flood
 * warning and alert for the Thames, and nothing on the lines.
 */
function otherNoticesAt(now: Date) {
  const fetchedAt = now.toISOString();
  return {
    postcode: 'SE17 3LL',
    country: 'GB',
    tfl_stops: [
      {
        stop_id: '940GZZLUEAC',
        lines: null,
        stations: {
          fetched_at: fetchedAt,
          stop_id: '940GZZLUEAC',
          disruptions: [
            {
              commonName: 'Elephant & Castle Underground Station',
              description: 'ELEPHANT & CASTLE UNDERGROUND STATION: The lift to the Bakerloo line is out of service.',
              toDate: hoursFrom(now, 30).toISOString()
            }
          ],
          shorts: []
        }
      }
    ],
    tfl_roads: {
      fetched_at: fetchedAt,
      postcode: 'SE17 3LL',
      disruptions: [
        {
          id: 'TIMS-1',
          severity: 'Severe',
          category: 'Collisions',
          comments:
            '[A3] Kennington Park Road (SE11) (Lambeth) - Northbound closed at Kennington Cross after a collision.',
          endDateTime: hoursFrom(now, 3).toISOString()
        }
      ],
      shorts: []
    },
    met_office: null,
    bank_holidays: null,
    tfl_network: tflNetworkAt(now),
    entur_stops: [],
    floods: {
      fetched_at: fetchedAt,
      postcode: 'SE17 3LL',
      floods: {
        items: [
          {
            description: 'River Thames at Southwark',
            severity: 'Flood Warning',
            severityLevel: 2,
            floodAreaID: '062FWF46Southwrk'
          },
          {
            description: 'Lower River Effra',
            severity: 'Flood Alert',
            severityLevel: 3,
            floodAreaID: '062WAF60LowEffra'
          }
        ]
      }
    },
    metalerts: null,
    bins: null
  };
}

/**
 * The notices of a kiosk in Oslo with `enturStops` (countdown-api's EnturStopNotices), MET Norway's warnings for its
 * place (`metalerts`, countdown-api's StoredMetAlerts) and its household's bin collection days (`bins`, countdown-api's
 * StoredBinCollections): none of London's sources.
 */
const osloNotices = (enturStops: object[], metalerts: object | null = null, bins: object | null = null) => ({
  postcode: '0150',
  country: 'NO',
  tfl_stops: [],
  tfl_roads: null,
  met_office: null,
  bank_holidays: null,
  tfl_network: null,
  entur_stops: enturStops,
  floods: null,
  metalerts,
  bins
});

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
  retryMs?: number | (() => number);
  /**
   * Notices as for a kiosk in Oslo instead: its Entur stops' situations (countdown-api's EnturStopNotices), and none
   * of London's sources.
   */
  enturStops?: () => object[];
  /** For the Oslo kiosk, MET Norway's warnings for its place (countdown-api's StoredMetAlerts). */
  metalerts?: object;
  /** For the Oslo kiosk, its household's bin collection days (countdown-api's StoredBinCollections). */
  bins?: object;
  /** A London board with the e-paper screens' other kinds of notice: a station's, a road's and flood warnings. */
  others?: boolean;
}

/**
 * Stands in for countdown-server's live feed (GET /api/devices/feed, countdown-api's getFeed) for an owned kiosk: each
 * stream sends the weather, departures and notices as read at `now` (the page's fixed clock) and then ends, as the
 * server's do; its `retry` keeps the next one a minute off unless `retryMs` says otherwise.
 */
export async function fakeFeed(page: Page, now: Date, options: FeedOptions = {}) {
  const {
    long = false,
    none = false,
    arrivals = () => arrivalsAt(now, long),
    retryMs = 60_000,
    enturStops,
    metalerts,
    bins,
    others = false
  } = options;
  const notices = () => {
    if (enturStops) return osloNotices(enturStops(), metalerts, bins);
    return others ? otherNoticesAt(now) : { ...noticesAt(now, none), entur_stops: [] };
  };
  await page.route(FEED, route => {
    const cors = corsFor(route.request().headers()['origin']);
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const events = [message('weather', weatherAt(now)), message('arrivals', arrivals()), message('notices', notices())];
    return route.fulfill({
      status: 200,
      headers: { ...cors, 'Cache-Control': 'no-store' },
      contentType: 'text/event-stream',
      body: `retry: ${String(typeof retryMs === 'function' ? retryMs() : retryMs)}\n\n${events.join('')}`
    });
  });
}

/** The arrivals of a kiosk with a Tube station for each of `lines`' groups, each departure on the next of its lines, read at `now`. */
export function linesAt(now: Date, lines: readonly (readonly string[])[]) {
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();
  return {
    stops: lines.map((names, stop) => {
      const id = `lines-${String(stop)}`;
      return {
        source: 'tfl',
        id,
        departures: {
          fetched_at: now.toISOString(),
          stop_id: id,
          name: `Station ${String(stop + 1)}`,
          mode: 'tube',
          stop_letter: null,
          modes: [],
          departures: names.map((lineName, index) => ({
            vehicle_id: `${id}-${String(index)}`,
            line: lineName,
            destination: 'Aldgate',
            expected_at: at(2 + index * 3),
            platform: `Westbound - Platform ${String(index + 1)}`,
            mode: null
          }))
        }
      };
    })
  };
}
