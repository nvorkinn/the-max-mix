// The departure boards' props (props.ts) from countdown-server's arrivals (countdown-api's DeviceArrivals): one board
// per stop, in the owner's order. A stop's buses go on a Bus board and its other departures (Tube, and Entur's metro,
// tram and rail) on a Tube board, so a stop serving both (Entur's) has one of each. Each board is soonest first, each
// row keyed by its vehicle so it follows its bus or train when predictions reorder.

import type { DeviceArrivals, StopDepartures } from 'countdown-api';
import { placeName } from './arrivals';
import type { BusDeparture, TubeDeparture } from './props';

type Departure = StopDepartures['departures'][number];

/** A departure more than this far past its time has gone, even if the data hasn't caught up (held or stale). */
const GONE_AFTER_MS = 60_000;

interface BoardBase {
  /** Unique among the boards: the stop's id with the board's kind. */
  id: string;
  /** The stop's id, whose freshness says whether the board is stale. */
  stopId: string;
  stopName: string;
}

export type Board =
  | (BoardBase & { kind: 'tube'; departures: TubeDeparture[] })
  | (BoardBase & { kind: 'bus'; departures: BusDeparture[] });

/** TfL's line id for a line's name, which picks its colour: "Hammersmith & City" is hammersmith-city. */
export function lineIdOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/ line$/, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join('-');
}

/** TfL's platformName ("Northbound - Platform 1") as the board writes it ("Platform 1 · Northbound"). */
export function platformOf(platform: string | null): string | null {
  if (!platform) return null;
  const [direction, place] = platform.split(' - ').map(part => part.trim());
  if (direction && place && /^platform /i.test(place)) return `${place} · ${direction}`;
  return /^platform /i.test(platform) ? platform : `Platform ${platform}`;
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

const isBus = (stop: StopDepartures, departure: Departure) => (departure.mode ?? stop.mode) === 'bus';

function busBoard(stop: StopDepartures, departures: readonly Departure[]): Board {
  const sorted = departures.filter(departure => isBus(stop, departure)).toSorted(soonestFirst);
  const ids = vehicleIds(stop, sorted);
  return {
    kind: 'bus',
    id: `bus:${stop.stop_id}`,
    stopId: stop.stop_id,
    stopName: placeName(stop.name),
    departures: sorted.map((departure, index) => ({
      vehicleId: ids[index] ?? '',
      route: departure.line,
      destination: departure.destination,
      expectedAt: departure.expected_at,
      stopLetter: departure.platform ?? stop.stop_letter
    }))
  };
}

function tubeBoard(stop: StopDepartures, departures: readonly Departure[]): Board {
  const sorted = departures.filter(departure => !isBus(stop, departure)).toSorted(soonestFirst);
  const ids = vehicleIds(stop, sorted);
  return {
    kind: 'tube',
    id: `tube:${stop.stop_id}`,
    stopId: stop.stop_id,
    stopName: placeName(stop.name),
    departures: sorted.map((departure, index) => ({
      vehicleId: ids[index] ?? '',
      lineId: lineIdOf(departure.line),
      lineName: departure.line,
      destination: departure.destination,
      expectedAt: departure.expected_at,
      platform: platformOf(departure.platform)
    }))
  };
}

/** The boards for `answer` at `now`, in the owner's order: none for a stop the server has no departures for yet. */
export function toBoards(answer: DeviceArrivals | null, now: Date): Board[] {
  const gone = now.getTime() - GONE_AFTER_MS;
  return (answer?.stops ?? []).flatMap(({ departures: stop }) => {
    if (!stop) return [];
    const departures = stop.departures.filter(departure => Date.parse(departure.expected_at) >= gone);
    const servesBus = stop.mode === 'bus' || stop.modes.includes('bus');
    const servesOther = stop.mode !== 'bus' || stop.modes.some(mode => mode !== 'bus');
    const boards = [
      ...(servesBus ? [busBoard(stop, departures)] : []),
      ...(servesOther ? [tubeBoard(stop, departures)] : [])
    ];
    // The stop's main mode first.
    return stop.mode === 'bus' ? boards : boards.toReversed();
  });
}
