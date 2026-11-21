// The departure boards' props (props.ts) from countdown-server's arrivals (countdown-api's DeviceArrivals): one board
// per stop, in the owner's order, whatever its modes: a stop serving several (Entur's Jernbanetorget: metro, tram and
// bus) mixes them on its one board. Each board is soonest first, each row keyed by its vehicle so it follows its bus or
// train when predictions reorder.

import type { DeviceArrivals, StopArrivals, StopDepartures } from 'countdown-api';
import { DEFAULT_LANGUAGE } from '../i18n/language';
import type { Language } from '../i18n/language';
import { translate } from '../i18n/translate';
import { type ClockFormat, DEFAULT_CLOCK_FORMAT, formatClockTime } from '../utils/clockFormat';
import { placeName } from './arrivals';
import type { Departure as BoardDeparture, Network } from './props';

type Departure = StopDepartures['departures'][number];

/** A departure more than this far past its time has gone, even if the data hasn't caught up (held or stale). */
const GONE_AFTER_MS = 60_000;

export interface Board {
  /** Unique among the boards: the stop's id. */
  id: string;
  /** The stop's id, whose freshness says whether the board is stale. */
  stopId: string;
  stopName: string;
  network: Network;
  stopLetter: string | null;
  departures: BoardDeparture[];
}

/** TfL's line id for a line's name, which picks its colour: "Hammersmith & City" is hammersmith-city. */
export function lineIdOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/ line$/, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join('-');
}

/**
 * TfL's platformName ("Northbound - Platform 1") as the board writes it ("Platform 1 · Northbound"), as TfL words it;
 * a bare one ("A", Entur's) in `language` ("Platform A" in English).
 */
export function platformOf(platform: string | null, language: Language = DEFAULT_LANGUAGE): string | null {
  if (!platform) return null;
  const [direction, place] = platform.split(' - ').map(part => part.trim());
  if (direction && place && /^platform /i.test(place)) return `${place} · ${direction}`;
  return /^platform /i.test(platform) ? platform : translate('board.platform', language, { platform });
}

/**
 * Each departure's key: its vehicle's id where the source gives one; otherwise (Entur, or a train TfL hasn't matched to
 * a set) one made from its stop, line and destination and how many of those come before it, which holds as long as
 * those don't overtake each other. Unique within the board.
 */
function vehicleIds(stop: StopDepartures, departures: readonly Departure[]): string[] {
  const seen = new Map<string, number>();
  return departures.map(departure => {
    const base = departure.vehicle_id ?? `${stop.stop_id}:${departure.line}:${departure.destination}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}#${count + 1}`;
  });
}

const soonestFirst = (a: Departure, b: Departure) => Date.parse(a.expected_at) - Date.parse(b.expected_at);

/** Modes whose stops are lettered stop poles ("Stop C") rather than numbered platforms. */
const STOP_POLE_MODES = new Set(['bus', 'tram', 'coach', 'water']);

/**
 * What a departure's row says under its destination: a train's platform; a bus's (or Entur's tram's) stop letter
 * where it isn't the stop's own, as at a hub whose departures leave from its several stops.
 */
function detailOf(
  stop: StopDepartures,
  mode: string,
  network: Network,
  platform: string | null,
  language: Language
): string | null {
  const isPole = mode === 'bus' || (network === 'entur' && STOP_POLE_MODES.has(mode));
  if (!isPole) return platformOf(platform, language);
  const letter = platform ?? stop.stop_letter;
  return letter && letter !== stop.stop_letter ? translate('board.stop', language, { letter }) : null;
}

function board(
  source: StopArrivals['source'],
  stop: StopDepartures,
  departures: readonly Departure[],
  clockFormat: ClockFormat,
  language: Language
): Board {
  const network: Network = source === 'tfl' ? 'tfl' : 'entur';
  const sorted = departures.toSorted(soonestFirst);
  const ids = vehicleIds(stop, sorted);
  return {
    id: stop.stop_id,
    stopId: stop.stop_id,
    stopName: placeName(stop.name),
    network,
    stopLetter: stop.stop_letter,
    departures: sorted.map((departure, index) => {
      const mode = departure.mode ?? stop.mode;
      return {
        vehicleId: ids[index] ?? '',
        ...(departure.vehicle_id !== null && { tracked: true as const }),
        mode,
        line: departure.line,
        lineId: lineIdOf(departure.line),
        destination: departure.destination,
        expectedAt: departure.expected_at,
        detail: detailOf(stop, mode, network, departure.platform, language),
        ...(departure.scheduled && { scheduledAt: formatClockTime(new Date(departure.expected_at), clockFormat) })
      };
    })
  };
}

/**
 * The boards for `answer` at `now`, in the owner's order: none for a stop the server has no departures for yet. A
 * timetabled departure's time is written in `clockFormat`, and a stop or platform in `language`.
 */
export function toBoards(
  answer: DeviceArrivals | null,
  now: Date,
  clockFormat: ClockFormat = DEFAULT_CLOCK_FORMAT,
  language: Language = DEFAULT_LANGUAGE
): Board[] {
  const gone = now.getTime() - GONE_AFTER_MS;
  return (answer?.stops ?? []).flatMap(({ source, departures: stop }) => {
    if (!stop) return [];
    const departures = stop.departures.filter(departure => Date.parse(departure.expected_at) >= gone);
    return [board(source, stop, departures, clockFormat, language)];
  });
}
