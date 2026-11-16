// What the Dashboard shows: Tube and bus departures, the weather and the notice board. For now it comes from the made-up data below, shaped
// roughly like countdown-server's JSON (an `arrivals` section and a `weather` section). getDashboardData is the only
// way in, so the real fetch and countdown-api's generated types can replace it without touching the components.

import type { TouchscreenConfig } from 'countdown-api';

/** One train or bus due at a stop. */
export interface Arrival {
  /** The Tube line or the bus route. */
  route: string;
  destination: string;
  /** The stop's letter or platform, when the stop has several. */
  stop?: string;
  /** When it is due, as an ISO time. */
  due: string;
}

interface ArrivalStop {
  name: string;
  /** Tube rows show the line name in its colour; bus rows show the route number. */
  mode: 'tube' | 'bus';
  /** Soonest first. */
  arrivals: Arrival[];
}

export interface Arrivals {
  /** When the server last read the departures, as an ISO time. */
  updatedAt: string;
  stops: ArrivalStop[];
}

export type Conditions = 'clear' | 'partly-cloudy' | 'cloudy' | 'rain' | 'snow';

interface HourForecast {
  /** The start of the hour, as an ISO time. */
  time: string;
  temperature: number;
  conditions: Conditions;
}

export interface Weather {
  /** When the server last read the weather, as an ISO time. */
  updatedAt: string;
  location: string;
  /** Degrees Celsius. */
  temperature: number;
  conditions: Conditions;
  high: number;
  low: number;
  /** The coming hours, soonest first. */
  hours: HourForecast[];
}

/** What a notice is about, which picks its icon. */
type NoticeKind = 'weather' | 'delays' | 'holiday' | 'closure';
/** How much it matters, which picks the colour down its edge: red, amber, none or blue. */
type NoticeSeverity = 'severe' | 'minor' | 'info' | 'planned';

/**
 * One notice-board item: a headline and one short line, which is all the board shows; `detail` is the provider's whole
 * text, shown when the notice is tapped.
 */
export interface Notice {
  id: string;
  kind: NoticeKind;
  severity: NoticeSeverity;
  /** A few words: "Northern line: Delays". */
  title: string;
  /** One short line: "Minor delays due to a signal fault". */
  summary: string;
  /** The provider's full text. */
  detail: string;
}

/** Either section is null when the server has none to give. */
export interface DashboardData {
  arrivals: Arrivals | null;
  weather: Weather | null;
  notices: Notice[];
}

/** Departures older than this are not shown: the buses on them have come and gone. */
export const ARRIVALS_MAX_AGE_MS = 5 * 60_000;
/** A forecast older than this is not shown. */
export const WEATHER_MAX_AGE_MS = 3 * 60 * 60_000;

/** Whether a section read at `updatedAt` is still worth showing at `now`. */
export function isFresh(updatedAt: string, maxAgeMs: number, now: Date): boolean {
  const age = now.getTime() - Date.parse(updatedAt);
  return Number.isFinite(age) && age <= maxAgeMs;
}

const MINUTE = 60_000;
const at = (now: Date, minutes: number) => new Date(now.getTime() + minutes * MINUTE).toISOString();

function mockArrivals(now: Date): Arrivals {
  const departure = (route: string, destination: string, minutes: number, stop?: string) => ({
    route,
    destination,
    due: at(now, minutes),
    ...(stop && { stop })
  });
  return {
    updatedAt: now.toISOString(),
    stops: [
      {
        name: 'Elephant & Castle',
        mode: 'tube',
        arrivals: [
          departure('Northern', 'High Barnet', 3),
          departure('Northern', 'Morden', 7),
          departure('Bakerloo', 'Harrow & Wealdstone', 9)
        ]
      },
      {
        name: 'Elephant & Castle',
        mode: 'bus',
        arrivals: [
          departure('12', 'Oxford Circus', 2, 'Stop E'),
          departure('343', 'New Cross', 6, 'Stop F'),
          departure('12', 'Oxford Circus', 11, 'Stop E')
        ]
      }
    ]
  };
}

function mockWeather(now: Date): Weather {
  const hour = new Date(now);
  hour.setMinutes(0, 0, 0);
  const forecast: [number, Conditions][] = [
    [9, 'partly-cloudy'],
    [10, 'cloudy'],
    [11, 'cloudy'],
    [11, 'rain'],
    [10, 'rain'],
    [9, 'cloudy']
  ];
  return {
    updatedAt: now.toISOString(),
    location: 'London',
    temperature: 9,
    conditions: 'partly-cloudy',
    high: 12,
    low: 6,
    hours: forecast.map(([temperature, conditions], index) => ({
      time: at(hour, (index + 1) * 60),
      temperature,
      conditions
    }))
  };
}

// The provider's full texts are real-world length, in the style TfL and the Met Office publish them.
const MOCK_NOTICES: Notice[] = [
  {
    id: 'rain',
    kind: 'weather',
    severity: 'severe',
    title: 'Weather warning',
    summary: 'Heavy rain expected 14:00–18:00',
    detail:
      'Yellow warning of rain for London & South East England. Heavy and persistent rain may lead to some flooding ' +
      'and travel disruption from 14:00 until 18:00 today. Spray and flooding on roads will probably make journey ' +
      'times longer, and bus and train services will probably be affected. 15 to 25 mm of rain is likely quite ' +
      'widely, with 30 to 40 mm possible in a few places.'
  },
  {
    id: 'northern',
    kind: 'delays',
    severity: 'minor',
    title: 'Northern line: Delays',
    summary: 'Minor delays due to a signal fault',
    detail:
      'NORTHERN LINE: Minor delays between Morden and Kennington while we fix a signal failure at Clapham Common. ' +
      'GOOD SERVICE on the rest of the line. Tickets will be accepted on London Buses, Southern and Thameslink ' +
      'between Morden and London Bridge. The Charing Cross branch is not affected.'
  },
  {
    id: 'christmas',
    kind: 'holiday',
    severity: 'info',
    title: 'Upcoming bank holiday',
    summary: 'Thu 25 Dec – Christmas Day',
    detail:
      'There will be no Tube, DLR, London Overground, Elizabeth line, tram or bus services on Christmas Day, ' +
      'except for a small number of local bus routes. Services on Boxing Day will start later than usual.'
  },
  {
    id: 'victoria',
    kind: 'closure',
    severity: 'planned',
    title: 'Victoria line: Planned work',
    summary: 'No service between Euston and Walthamstow this weekend',
    detail:
      'VICTORIA LINE: Saturday 22 and Sunday 23 November, no service between Euston and Walthamstow Central while ' +
      'we carry out track renewal works. Replacement buses operate between Euston, Highbury & Islington, Finsbury ' +
      'Park, Seven Sisters and Walthamstow Central. Use London Overground or the Piccadilly line where you can. ' +
      'Allow extra time for your journey.'
  }
];

/**
 * The owner's Dashboard settings from the kiosk's config on countdown-server (its stops, weather place and notice
 * board), or null before anyone owns the kiosk. The data is for these.
 */
export type DashboardSettings = Pick<TouchscreenConfig, 'arrivals' | 'weather' | 'notice_board'> | null;

/**
 * The Dashboard's data for the owner's settings. Made up for now, the same whatever the settings; see the top of this
 * file.
 */
export function getDashboardData(_settings: DashboardSettings, now = new Date()): Promise<DashboardData> {
  return Promise.resolve({ arrivals: mockArrivals(now), weather: mockWeather(now), notices: MOCK_NOTICES });
}
