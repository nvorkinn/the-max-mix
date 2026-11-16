// What the Dashboard shows: Tube and bus departures, the weather and the notice board. The departures and the weather
// come from countdown-server (arrivals.ts, weather.ts); the notices from the made-up data below, shaped roughly like
// countdown-server's JSON. getDashboardData is the only way in, so the real fetches and countdown-api's generated types
// can replace it without touching the components.

import type { TouchscreenConfig } from 'countdown-api';
import { readArrivals } from './arrivals';
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
 * The Dashboard's data for the owner's settings: the departures from countdown-server (none asked for without an owner
 * or stops) and its weather; the notices made up for now, the same whatever the settings.
 */
export async function getDashboardData(settings: DashboardSettings, now = new Date()): Promise<DashboardData> {
  const arrivals = settings && settings.arrivals.stops.length > 0 ? await readArrivals(now) : null;
  return { arrivals, weather: await getWeather(now), notices: MOCK_NOTICES };
}
