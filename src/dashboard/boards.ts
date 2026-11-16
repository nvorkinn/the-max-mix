// The Tube and Bus boards' props (props.ts) from countdown-server's arrivals (countdown-api's DeviceArrivals): every
// bus at the kiosk's stops on the Bus board, every other departure (Tube, and Entur's metro, tram and rail) on the Tube
// board, soonest first, each keyed by its vehicle so a row follows its bus or train when predictions reorder.

import type { DeviceArrivals, StopDepartures } from 'countdown-api';
import { placeName } from './arrivals';
import type { BusDeparture, TubeDeparture } from './props';

type Departure = StopDepartures['departures'][number];

/** A departure more than this far past its time has gone, even if the data hasn't caught up (held or stale). */
const GONE_AFTER_MS = 60_000;

export interface Boards {
  tube: { stopName: string; departures: TubeDeparture[]; stopIds: string[] } | null;
  bus: { stopName: string; departures: BusDeparture[]; stopIds: string[] } | null;
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

/** TfL's platformName ("Northbound - Platform 1") as the board writes it ("Platform 1 · Northbound"). */
export function platformOf(platform: string | null): string | null {
  if (!platform) return null;
  const [direction, place] = platform.split(' - ').map(part => part.trim());
  if (direction && place && /^platform /i.test(place)) return `${place} · ${direction}`;
  return /^platform /i.test(platform) ? platform : `Platform ${platform}`;
}

interface Placed {
  stop: StopDepartures;
  departure: Departure;
}

/**
 * Each departure's key: its vehicle's id where the source gives one; otherwise (Entur, or a train TfL hasn't matched to
 * a set) one made from its stop, line and destination and how many of those come before it, which holds as long as
 * those don't overtake each other. Unique within the board.
 */
function vehicleIds(placed: readonly Placed[]): string[] {
  const seen = new Map<string, number>();
  return placed.map(({ stop, departure }) => {
    const base = departure.vehicle_id ?? `${stop.stop_id}:${departure.line}:${departure.destination}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}#${count + 1}`;
  });
}

/** The name the board is headed with: its first stop's. */
const firstName = (from: readonly StopDepartures[]) => placeName(from[0]?.name ?? '');

const soonestFirst = (a: Placed, b: Placed) =>
  Date.parse(a.departure.expected_at) - Date.parse(b.departure.expected_at);

/** The boards for `answer` at `now`: null for a board none of the kiosk's stops has departures for. */
export function toBoards(answer: DeviceArrivals | null, now: Date): Boards {
  const stops = (answer?.stops ?? []).flatMap(stop => (stop.departures ? [stop.departures] : []));
  const gone = now.getTime() - GONE_AFTER_MS;
  const placed = stops.flatMap(stop =>
    stop.departures
      .filter(departure => Date.parse(departure.expected_at) >= gone)
      .map(departure => ({ stop, departure, bus: (departure.mode ?? stop.mode) === 'bus' }))
  );
  const busStops = stops.filter(stop => stop.mode === 'bus' || stop.modes.includes('bus'));
  const tubeStops = stops.filter(stop => stop.mode !== 'bus' || stop.modes.some(mode => mode !== 'bus'));

  const buses = placed.filter(entry => entry.bus).toSorted(soonestFirst);
  const busIds = vehicleIds(buses);
  const trains = placed.filter(entry => !entry.bus).toSorted(soonestFirst);
  const trainIds = vehicleIds(trains);

  return {
    bus:
      busStops.length === 0
        ? null
        : {
            stopName: firstName(busStops),
            stopIds: busStops.map(stop => stop.stop_id),
            departures: buses.map(({ stop, departure }, index) => ({
              vehicleId: busIds[index] ?? '',
              route: departure.line,
              destination: departure.destination,
              expectedAt: departure.expected_at,
              stopLetter: departure.platform ?? stop.stop_letter
            }))
          },
    tube:
      tubeStops.length === 0
        ? null
        : {
            stopName: firstName(tubeStops),
            stopIds: tubeStops.map(stop => stop.stop_id),
            departures: trains.map(({ departure }, index) => ({
              vehicleId: trainIds[index] ?? '',
              lineId: lineIdOf(departure.line),
              lineName: departure.line,
              destination: departure.destination,
              expectedAt: departure.expected_at,
              platform: platformOf(departure.platform)
            }))
          }
  };
}
