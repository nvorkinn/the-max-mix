// What the Dashboard shows: Tube and bus departures, the weather and the notice board. The departures (arrivals.ts) and
// the notices (notices.ts) come from countdown-server; the weather from the made-up data below, shaped roughly like
// countdown-server's JSON.
// getDashboardData is the only way in, so the real fetches and countdown-api's generated types can replace it without
// touching the components.

import type { TouchscreenConfig } from 'countdown-api';
import type { ClockFormat } from '../utils/clockFormat';
import { DEFAULT_CLOCK_FORMAT } from '../utils/clockFormat';
import { readArrivals } from './arrivals';
import { readNotices } from './notices';

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

/**
 * The owner's Dashboard settings from the kiosk's config on countdown-server (its stops, weather place and notice
 * board), or null before anyone owns the kiosk. The data is for these.
 */
export type DashboardSettings = Pick<TouchscreenConfig, 'arrivals' | 'weather' | 'notice_board'> | null;

/**
 * The Dashboard's data for the owner's settings, with times in `clockFormat`: the departures and the notices from
 * countdown-server (none asked for without an owner, or without stops or a notice board's postcode); the weather made
 * up for now, the same whatever the settings.
 */
export async function getDashboardData(
  settings: DashboardSettings,
  now = new Date(),
  clockFormat: ClockFormat = DEFAULT_CLOCK_FORMAT
): Promise<DashboardData> {
  const [arrivals, notices] = await Promise.all([
    settings && settings.arrivals.stops.length > 0 ? readArrivals(now) : null,
    settings?.notice_board.postcode ? readNotices(now, clockFormat) : []
  ]);
  return { arrivals, weather: mockWeather(now), notices };
}
