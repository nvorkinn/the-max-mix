// What the Dashboard shows: Tube and bus departures, the weather and the notice board, all from countdown-server
// (arrivals.ts, weather.ts, notices.ts). getDashboardData is the only way in, so the components don't know where it
// comes from.

import type { TouchscreenConfig } from 'countdown-api';
import type { ClockFormat } from '../utils/clockFormat';
import { DEFAULT_CLOCK_FORMAT } from '../utils/clockFormat';
import { readArrivals } from './arrivals';
import { readNotices } from './notices';
import { getWeather } from './weather';
import type { Weather } from './weather';

export type { Conditions, Weather } from './weather';

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

/**
 * The owner's Dashboard settings from the kiosk's config on countdown-server (its stops, weather place and notice
 * board), or null before anyone owns the kiosk. The data is for these.
 */
export type DashboardSettings = Pick<TouchscreenConfig, 'arrivals' | 'weather' | 'notice_board'> | null;

/**
 * The Dashboard's data for the owner's settings, with times in `clockFormat`: the departures and the notices from
 * countdown-server (none asked for without an owner, or without stops or a notice board's postcode), and its weather.
 */
export async function getDashboardData(
  settings: DashboardSettings,
  now = new Date(),
  clockFormat: ClockFormat = DEFAULT_CLOCK_FORMAT
): Promise<DashboardData> {
  const [arrivals, weather, notices] = await Promise.all([
    settings && settings.arrivals.stops.length > 0 ? readArrivals(now) : null,
    getWeather(now),
    settings?.notice_board.postcode ? readNotices(now, clockFormat) : []
  ]);
  return { arrivals, weather, notices };
}
