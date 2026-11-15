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

/** Either section is null when the server has none to give. */
export interface DashboardData {
  arrivals: Arrivals | null;
  weather: Weather | null;
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
  const bus = (route: string, destination: string, minutes: number) => ({ route, destination, due: at(now, minutes) });
  return {
    updatedAt: now.toISOString(),
    stops: [
      {
        name: 'Elephant & Castle',
        arrivals: [bus('12', 'Oxford Circus', 1), bus('35', 'Shoreditch', 4), bus('12', 'Oxford Circus', 9)]
      },
      {
        name: 'Walworth Road',
        arrivals: [bus('171', 'Holborn', 3), bus('176', 'Tottenham Court Road', 7), bus('171', 'Holborn', 15)]
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

/** The Dashboard's data. Made up for now; see the top of this file. */
export function getDashboardData(now = new Date()): Promise<DashboardData> {
  return Promise.resolve({ arrivals: mockArrivals(now), weather: mockWeather(now) });
}
