// What the Dashboard shows: bus departures and the weather. For now it comes from the made-up data below, shaped
// roughly like countdown-server's JSON (an `arrivals` section and a `weather` section). getDashboardData is the only
// way in, so the real fetch and countdown-api's generated types can replace it without touching the components.

/** One bus due at a stop. */
export interface Arrival {
  route: string;
  destination: string;
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

/** How bad a notice is: picks its colour. */
type NoticeSeverity = 'good' | 'minor' | 'severe' | 'closed' | 'info';

/**
 * One notice-board item. The board draws it from the structured fields alone (what it is about, how bad, a two or
 * three word status and when); `title` and `detail` are the provider's own words, shown only when it is tapped.
 */
export interface Notice {
  id: string;
  kind: 'tube' | 'bus' | 'weather' | 'holiday';
  /** The tube line or bus route the notice is about. */
  line?: string;
  severity: NoticeSeverity;
  /** Two or three words: "Delays", "Closed", "Heavy rain". */
  status: string;
  /** When it applies, as short as possible: "14:00–18:00", "Sat–Sun", "Thu 25 Dec". */
  when?: string;
  /** The provider's headline. */
  title: string;
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
  const departure = (route: string, destination: string, minutes: number) => ({
    route,
    destination,
    due: at(now, minutes)
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
          departure('12', 'Oxford Circus', 1),
          departure('35', 'Shoreditch', 4),
          departure('12', 'Oxford Circus', 9)
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
    [10, 'partly-cloudy'],
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

// Real-world-length texts, in the style TfL and the Met Office publish them.
const MOCK_NOTICES: Notice[] = [
  {
    id: 'northern',
    kind: 'tube',
    line: 'Northern',
    severity: 'minor',
    status: 'Delays',
    title: 'Northern line: Minor delays',
    detail:
      'NORTHERN LINE: Minor delays between Morden and Kennington while we fix a signal failure at Clapham Common. ' +
      'GOOD SERVICE on the rest of the line. Tickets will be accepted on London Buses, Southern and Thameslink ' +
      'between Morden and London Bridge. The Charing Cross branch is not affected.'
  },
  {
    id: 'rain',
    kind: 'weather',
    severity: 'severe',
    status: 'Heavy rain',
    when: '14:00–18:00',
    title: 'Yellow warning of rain for London & South East England',
    detail:
      'Heavy and persistent rain may lead to some flooding and travel disruption from 14:00 until 18:00 today. ' +
      'Spray and flooding on roads will probably make journey times longer, and bus and train services will ' +
      'probably be affected, with journey times taking longer. 15 to 25 mm of rain is likely quite widely, with ' +
      '30 to 40 mm possible in a few places.'
  },
  {
    id: 'jubilee',
    kind: 'tube',
    line: 'Jubilee',
    severity: 'closed',
    status: 'Closed',
    when: 'Sat–Sun',
    title: 'Jubilee line: Planned closure',
    detail:
      'JUBILEE LINE: Saturday 22 and Sunday 23 November, no service between Stratford and Waterloo while we carry ' +
      'out track renewal works. Replacement buses operate between Stratford, Canning Town, North Greenwich and ' +
      'Canary Wharf. Use the DLR, Elizabeth line or Southeastern services. Allow extra time for your journey.'
  },
  {
    id: 'bus-12',
    kind: 'bus',
    line: '12',
    severity: 'minor',
    status: 'Diverted',
    title: 'Route 12: Diverted',
    detail:
      'Route 12 is diverted away from Walworth Road between Elephant & Castle and Camberwell Green in both ' +
      'directions due to Thames Water emergency works. Buses will not serve stops from Walworth Road / East ' +
      'Street to Camberwell Road / Albany Road. Use route 35, 40, 45, 68, 171, 176 or P5 as alternatives.'
  },
  {
    id: 'christmas',
    kind: 'holiday',
    severity: 'info',
    status: 'Christmas Day',
    when: 'Thu 25 Dec',
    title: 'Christmas Day: no public transport',
    detail:
      'There will be no Tube, DLR, London Overground, Elizabeth line, tram or bus services on Christmas Day, ' +
      'except for a small number of local bus routes. Santander Cycles will be available. Services on Boxing Day ' +
      'will start later than usual.'
  }
];

/** The Dashboard's data. Made up for now; see the top of this file. */
export function getDashboardData(now = new Date()): Promise<DashboardData> {
  return Promise.resolve({ arrivals: mockArrivals(now), weather: mockWeather(now), notices: MOCK_NOTICES });
}
