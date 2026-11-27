// Stop and place search for the Dashboard settings: countdown-server's GET /api/stops/search (TfL and Entur) and
// GET /api/places/search (Open-Meteo), with the device secret. A build that sets VITE_COUNTDOWN_CONFIG=mock searches
// countdown-api's example answers instead. The config keeps only a stop's source and id, so the kiosk keeps the name
// and line under it of each stop it adds, to show in the list, and learns the names of stops added elsewhere (the
// settings site) from the stops' departures.

import type { DepartureStop, PlaceSearchResult, StopSearchResult, Weather } from 'countdown-api';
import {
  getArrivals,
  locatePlace as locatePlaceRoute,
  searchPlaces as searchPlacesRoute,
  searchStops as searchStopsRoute,
  stopsNear
} from '../../../vendor/countdown-api/src/countdown_api/client';
import type { Client, Result } from '../../../vendor/countdown-api/src/countdown_api/client';
import { serverClient } from './config';
import { mockLocation } from './location';
import type { Position } from './location';

// Each stop's name, line under it and (a London bus stop's) letter. A new key, not maxmix.stopNames: those were kept
// before the letter was, with "Stop K" written in the line instead, so the kiosk learns its stops again.
const STOP_NAMES_KEY = 'maxmix.savedStops';

/** One thing a search found, as the search dialog lists it, and what picking it saves. */
export interface SearchResult<V = unknown> {
  /** Tells it apart from the other results. */
  key: string;
  name: string;
  /** The line under it: what stops there, or the place's region and country. */
  detail: string;
  /** A London bus stop's letter ("K"), shown in a red disc by its name as on the stop's flag. */
  letter?: string;
  /** A platform of the station before it, listed under it. */
  indent: boolean;
  value: V;
}

export type StopResult = SearchResult<DepartureStop>;
/** A stop near a position, and how far from it it is, in metres. */
export type NearbyStop = StopResult & { distance: number };
export type PlaceResult = SearchResult<Weather>;

/** The search couldn't be made: the kiosk isn't registered, or the server refused or couldn't be reached. */
export class SearchFailed extends Error {
  constructor() {
    super('Search failed');
    this.name = 'SearchFailed';
  }
}

function stopKey(stop: DepartureStop): string {
  return `${stop.source}:${stop.id}`;
}

/** A London bus stop's letter, which its flag shows in a red disc; nothing for any other stop. */
function flagLetter(source: DepartureStop['source'], mode: string, letter: string | null | undefined) {
  return source === 'tfl' && mode === 'bus' && letter ? letter : undefined;
}

function fromStop(result: StopSearchResult): StopResult {
  const letter = flagLetter(result.source, result.mode, result.letter);
  return {
    key: stopKey(result.value),
    name: result.name,
    // The letter shows in its disc, so the line under it is just the routes, not the server's "Stop K • 12, 35".
    detail: letter ? result.lines.join(', ') : result.subtitle,
    ...(letter && { letter }),
    indent: result.indent,
    value: result.value
  };
}

function fromPlace(result: PlaceSearchResult): PlaceResult {
  return { key: result.id, name: result.name, detail: result.subtitle, indent: result.indent, value: result.value };
}

interface MockAnswers {
  stops: StopSearchResult[];
  places: PlaceSearchResult[];
  here: PlaceSearchResult[];
}

/** countdown-api's example answer to one of the searches, for a build that mocks the server. */
async function mockAnswer<K extends keyof MockAnswers>(search: K): Promise<MockAnswers[K]> {
  const fixture = await import('../../../vendor/countdown-api/src/countdown_api/fixtures/search.json');
  return (fixture.default as unknown as MockAnswers)[search];
}

/** Asks one of the search routes with the device secret. Rejects with SearchFailed when it can't search. */
async function ask<T>(route: (client: Client, query: { q: string }) => Promise<Result<T[]>>, query: string) {
  const client = serverClient();
  if (!client) throw new SearchFailed();
  const answer = await route(client, { q: query }).catch(() => null);
  if (!answer?.data) throw new SearchFailed();
  return answer.data;
}

/** Stations and stops whose name has the words typed, best first. Rejects with SearchFailed when it can't search. */
export async function searchStops(query: string): Promise<StopResult[]> {
  const mock = import.meta.env.VITE_COUNTDOWN_CONFIG === 'mock';
  const found = mock ? await mockAnswer('stops') : await ask(searchStopsRoute, query);
  return found.map(result => fromStop(result));
}

/** Towns and cities for the weather whose name has the words typed. Rejects with SearchFailed when it can't search. */
export async function searchPlaces(query: string): Promise<PlaceResult[]> {
  const mock = import.meta.env.VITE_COUNTDOWN_CONFIG === 'mock';
  const found = mock ? await mockAnswer('places') : await ask(searchPlacesRoute, query);
  return found.map(result => fromPlace(result));
}

/** How long the browser may take to find where it is before the server places the kiosk by its IP instead. */
const POSITION_TIMEOUT_MS = 10_000;
/** How old a position the browser found earlier may be and still be used: a kiosk doesn't move far. */
const POSITION_MAX_AGE_MS = 60 * 60 * 1000;

/** Where the browser is (getCurrentPosition), or null when it can't tell or isn't allowed to. */
function currentPosition(): Promise<{ latitude: number; longitude: number } | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      () => resolve(null),
      { timeout: POSITION_TIMEOUT_MS, maximumAge: POSITION_MAX_AGE_MS }
    );
  });
}

/**
 * The town or city the kiosk is in, for the weather: the one at `at` when given (the setup wizard's postcode), else at
 * the browser's position, or where countdown-server places its IP when the browser has none (a Pi has no GPS). Null
 * when none can tell. Rejects with SearchFailed when the server can't be asked.
 */
export async function locatePlace(at?: Position): Promise<PlaceResult | null> {
  if (import.meta.env.VITE_COUNTDOWN_CONFIG === 'mock') {
    const [here] = await mockAnswer('here');
    return here ? fromPlace(here) : null;
  }
  const client = serverClient();
  if (!client) throw new SearchFailed();
  const position = at ?? (await currentPosition());
  const answer = await locatePlaceRoute(client, position ?? {}).catch(() => null);
  if (!answer?.data) throw new SearchFailed();
  const [here] = answer.data;
  return here ? fromPlace(here) : null;
}

/**
 * The stations and stops nearest a position, nearest first, each with how far it is; none outside TfL's area. Rejects
 * with SearchFailed when it can't search.
 */
export async function nearbyStops(at: Position, signal?: AbortSignal): Promise<NearbyStop[]> {
  let found;
  if (import.meta.env.VITE_COUNTDOWN_CONFIG === 'mock') {
    const fixture = await mockLocation();
    found = fixture.stops_near;
  } else {
    const client = serverClient();
    if (!client) throw new SearchFailed();
    const query = { latitude: at.latitude, longitude: at.longitude };
    const answer = await stopsNear(client, query, { ...(signal && { signal }) }).catch(() => null);
    if (!answer?.data) throw new SearchFailed();
    found = answer.data;
  }
  return found.map(result => ({ ...fromStop(result), distance: result.distance }));
}

type StopNames = Record<string, { name: string; detail: string; letter?: string }>;

function storedStopNames(): StopNames {
  try {
    const stored = localStorage.getItem(STOP_NAMES_KEY);
    return stored ? (JSON.parse(stored) as StopNames) : {};
  } catch {
    return {};
  }
}

/** Keeps a stop's name and the line under it, as the search found it, for the departures list. */
export function rememberStop(result: StopResult): void {
  try {
    const names = storedStopNames();
    names[result.key] = { name: result.name, detail: result.detail, ...(result.letter && { letter: result.letter }) };
    localStorage.setItem(STOP_NAMES_KEY, JSON.stringify(names));
  } catch {
    // Storage is unavailable: the stop shows its id instead.
  }
}

/**
 * A saved stop's name, the line under it and (a London bus stop's) letter, when this kiosk added it or learnt its name;
 * otherwise its id stands in for the name.
 */
export function describeStop(stop: DepartureStop): { name: string; detail: string; letter?: string } {
  const source = stop.source === 'tfl' ? 'TfL' : 'Entur';
  const known = storedStopNames()[stopKey(stop)];
  if (!known) return { name: stop.id, detail: source };
  return {
    name: known.name,
    detail: known.detail ? `${known.detail} · ${source}` : source,
    ...(known.letter && { letter: known.letter })
  };
}

/**
 * Keeps the names of the device's stops that this kiosk has no name for (ones added on the settings site), as their
 * departures on countdown-server name them. Answers whether it learnt any. Nothing is asked in a mock build, or when the
 * kiosk isn't registered; a failed ask learns nothing.
 */
export async function learnStopNames(): Promise<boolean> {
  if (import.meta.env.VITE_COUNTDOWN_CONFIG === 'mock') return false;
  const client = serverClient();
  if (!client) return false;
  const answer = await getArrivals(client).catch(() => null);
  if (!answer?.data) return false;
  const known = storedStopNames();
  let learnt = false;
  for (const stop of answer.data.stops) {
    const key = stopKey(stop);
    if (!stop.departures || Object.hasOwn(known, key)) continue;
    const letter = flagLetter(stop.source, stop.departures.mode, stop.departures.stop_letter);
    rememberStop({
      key,
      name: stop.departures.name,
      detail: '',
      ...(letter && { letter }),
      indent: false,
      value: stop
    });
    learnt = true;
  }
  return learnt;
}
