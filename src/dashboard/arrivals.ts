// The Dashboard's departures, from countdown-server's screens' API: GET /api/devices/arrivals with the device secret.
// countdown-server reads TfL and Entur for the stops in the kiosk's config; the kiosk asks nobody else. The route isn't
// in countdown-api's contract yet, so its answer is typed here as proposed (ArrivalsResponse) and the call is made by
// hand; once the contract has it, its generated function and types replace both. A build that sets
// VITE_COUNTDOWN_CONFIG=mock gets made-up departures instead.

import { serverClient } from '../countdown/config';
import { debugLog } from '../utils/debugLog';
import { errorMessage } from '../utils/errorMessage';
import { ARRIVALS_MAX_AGE_MS, isFresh } from './data';
import type { Arrival, Arrivals } from './data';

// cspell:ignore GZZLUEAC HUBZEC

/** GET /api/devices/arrivals's answer, as proposed to countdown-api: every stop in the config, in the owner's order. */
export interface ArrivalsResponse {
  stops: {
    source: 'tfl' | 'entur';
    id: string;
    name: string;
    /** When the server last read the stop; null when it never has. */
    fetched_at: string | null;
    /** Soonest first. */
    departures: {
      /** TfL's mode (tube, bus, dlr, overground, elizabeth-line, tram, ...) or Entur's. */
      mode: string;
      /** The line's name or the route's number. */
      line: string;
      destination: string;
      /** The stop's letter or platform the departure leaves from, when the stop has several ("E"); else null. */
      stop_letter: string | null;
      /** When it is due, as an ISO time. */
      expected: string;
    }[];
  }[];
}

/**
 * The answer as the Dashboard's Arrivals: each stop split into its buses and its trains, stops the server hasn't read
 * for a while left out. Null when no stop is left.
 */
export function fromServer(answer: ArrivalsResponse, now: Date): Arrivals | null {
  const read = answer.stops.filter(
    (stop): stop is typeof stop & { fetched_at: string } =>
      stop.fetched_at !== null && isFresh(stop.fetched_at, ARRIVALS_MAX_AGE_MS, now)
  );
  if (read.length === 0) return null;
  const stops = read
    .flatMap(stop =>
      (['tube', 'bus'] as const).map(mode => {
        const arrivals: Arrival[] = stop.departures
          .filter(departure => (departure.mode === 'bus') === (mode === 'bus'))
          .map(departure => ({
            route: departure.line,
            destination: departure.destination,
            due: departure.expected,
            ...(departure.stop_letter && { stop: `Stop ${departure.stop_letter}` })
          }))
          .toSorted((first, second) => Date.parse(first.due) - Date.parse(second.due));
        return { name: stop.name, mode, arrivals };
      })
    )
    .filter(stop => stop.arrivals.length > 0);
  const updatedAt = read
    .map(stop => stop.fetched_at)
    .toSorted((first, second) => Date.parse(first) - Date.parse(second))[0];
  return { updatedAt: updatedAt ?? now.toISOString(), stops };
}

/** Made-up departures for a build that mocks countdown-server, timed from now. */
export function mockAnswer(now: Date): ArrivalsResponse {
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();
  const departure = (
    mode: string,
    line: string,
    destination: string,
    minutes: number,
    letter: string | null = null
  ) => ({
    mode,
    line,
    destination,
    stop_letter: letter,
    expected: at(minutes)
  });
  return {
    stops: [
      {
        source: 'tfl',
        id: '940GZZLUEAC',
        name: 'Elephant & Castle',
        fetched_at: now.toISOString(),
        departures: [
          departure('tube', 'Northern', 'High Barnet', 3),
          departure('tube', 'Northern', 'Morden', 7),
          departure('tube', 'Bakerloo', 'Harrow & Wealdstone', 9)
        ]
      },
      {
        source: 'tfl',
        id: 'HUBZEC',
        name: 'Elephant & Castle',
        fetched_at: now.toISOString(),
        departures: [
          departure('bus', '12', 'Oxford Circus', 2, 'E'),
          departure('bus', '343', 'New Cross', 6, 'F'),
          departure('bus', '12', 'Oxford Circus', 11, 'E')
        ]
      }
    ]
  };
}

async function fetchAnswer(signal?: AbortSignal): Promise<ArrivalsResponse> {
  const server = serverClient();
  if (!server?.secret) throw new Error('the kiosk is not registered with countdown-server');
  const response = await fetch(new URL('/api/devices/arrivals', server.baseUrl), {
    headers: { Authorization: `Bearer ${server.secret}` },
    signal: signal ?? null
  });
  if (!response.ok) throw new Error(`countdown-server answered ${response.status}`);
  return (await response.json()) as ArrivalsResponse;
}

// The last answer the server gave, so one failed read doesn't blank the departures; they go once it is too old.
let lastAnswer: ArrivalsResponse | null = null;

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
