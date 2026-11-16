// The Dashboard's departures, from countdown-server's screens' API: getArrivals (GET /api/devices/arrivals) with the
// device secret. countdown-server reads TfL and Entur for the stops in the kiosk's config; the kiosk asks nobody else.
// A build that sets VITE_COUNTDOWN_CONFIG=mock gets made-up departures instead.

import type { DeviceArrivals, StopDepartures } from 'countdown-api';
import { getArrivals } from '../../vendor/countdown-api/src/countdown_api/client';
import { serverClient } from '../countdown/config';
import { debugLog } from '../utils/debugLog';
import { errorMessage } from '../utils/errorMessage';
import { ARRIVALS_MAX_AGE_MS, isFresh } from './data';
import type { Arrival, Arrivals } from './data';

// cspell:ignore GZZLUEAC

const STATION_KINDS = [' Underground Station', ' DLR Station', ' Rail Station', ' Overground Station', ' Tram Stop'];

/** The source's name without the kind of station it is: "Kennington Underground Station" is "Kennington". */
function placeName(name: string): string {
  const kind = STATION_KINDS.find(suffix => name.endsWith(suffix));
  return kind ? name.slice(0, -kind.length) : name;
}

/** Where at the stop a departure leaves from: a London bus stop's letter, or the platform the source gives. */
function stopOf(stop: StopDepartures, departure: StopDepartures['departures'][number]): string | null {
  if (departure.platform) return `Platform ${departure.platform}`;
  return stop.stop_letter ? `Stop ${stop.stop_letter}` : null;
}

/**
 * The answer as the Dashboard's Arrivals: each stop split into its buses and everything else (the Tube card), soonest
 * first; stops with nothing stored, or read too long ago, left out. Null when no stop is left.
 */
export function fromServer(answer: DeviceArrivals, now: Date): Arrivals | null {
  const read = answer.stops.flatMap(stop =>
    stop.departures && isFresh(stop.departures.fetched_at, ARRIVALS_MAX_AGE_MS, now) ? [stop.departures] : []
  );
  if (read.length === 0) return null;
  const stops = read
    .flatMap(stop =>
      (['tube', 'bus'] as const).map(mode => {
        const arrivals: Arrival[] = stop.departures
          .filter(departure => ((departure.mode ?? stop.mode) === 'bus') === (mode === 'bus'))
          .map(departure => {
            const where = stopOf(stop, departure);
            return {
              route: departure.line,
              destination: departure.destination,
              due: departure.expected_at,
              ...(where && { stop: where })
            };
          })
          .toSorted((first, second) => Date.parse(first.due) - Date.parse(second.due));
        return { name: placeName(stop.name), mode, arrivals };
      })
    )
    .filter(stop => stop.arrivals.length > 0);
  const updatedAt = read
    .map(stop => stop.fetched_at)
    .toSorted((first, second) => Date.parse(first) - Date.parse(second))[0];
  return { updatedAt: updatedAt ?? now.toISOString(), stops };
}

/** Made-up departures for a build that mocks countdown-server, timed from now. */
export function mockAnswer(now: Date): DeviceArrivals {
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();
  const departure = (line: string, destination: string, minutes: number) => ({
    line,
    destination,
    expected_at: at(minutes),
    platform: null,
    mode: null
  });
  const stop = (id: string, mode: string, departures: StopDepartures['departures'], letter: string | null = null) => ({
    source: 'tfl' as const,
    id,
    departures: {
      fetched_at: now.toISOString(),
      stop_id: id,
      name: 'Elephant & Castle',
      mode,
      stop_letter: letter,
      modes: [],
      departures
    }
  });
  return {
    stops: [
      stop('940GZZLUEAC', 'tube', [
        departure('Northern', 'High Barnet', 3),
        departure('Northern', 'Morden', 7),
        departure('Bakerloo', 'Harrow & Wealdstone', 9)
      ]),
      stop('490000077E', 'bus', [departure('12', 'Oxford Circus', 2), departure('343', 'New Cross', 6)], 'E')
    ]
  };
}

async function fetchAnswer(signal?: AbortSignal): Promise<DeviceArrivals> {
  const server = serverClient();
  if (!server) throw new Error('the kiosk is not registered with countdown-server');
  const { data, response } = await getArrivals(server, signal ? { signal } : {});
  if (!data) throw new Error(`countdown-server answered ${response.status}`);
  return data;
}

// The last answer the server gave, so one failed read doesn't blank the departures; they go once it is too old.
let lastAnswer: DeviceArrivals | null = null;

/**
 * The departures at the kiosk's stops (those in its config on countdown-server). A failed read gives the last answer
 * again; null when there is nothing recent enough to show.
 */
export async function readArrivals(now = new Date(), signal?: AbortSignal): Promise<Arrivals | null> {
  if (import.meta.env.VITE_COUNTDOWN_CONFIG === 'mock') return fromServer(mockAnswer(now), now);
  try {
    lastAnswer = await fetchAnswer(signal);
  } catch (caught) {
    debugLog('warn', 'dashboard', `Could not read the departures: ${errorMessage(caught)}`);
  }
  return lastAnswer && fromServer(lastAnswer, now);
}

/** Forgets the last answer (for tests). */
export function forgetArrivals(): void {
  lastAnswer = null;
}
