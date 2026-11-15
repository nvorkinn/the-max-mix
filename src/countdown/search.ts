// Stop and place search for the Dashboard settings: countdown-server's GET /api/stops/search (TfL and Entur) and
// GET /api/places/search (Open-Meteo), with the device secret. A build that sets VITE_COUNTDOWN_CONFIG=mock searches
// countdown-api's example answers instead. The config keeps only a stop's source and id, so the kiosk keeps the name
// and line under it of each stop it adds, to show in the list.

import type { DepartureStop, PlaceSearchResult, StopSearchResult, Weather } from 'countdown-api';
import {
  searchPlaces as searchPlacesRoute,
  searchStops as searchStopsRoute
} from '../../vendor/countdown-api/src/countdown_api/client';
import { serverClient } from './config';

const STOP_NAMES_KEY = 'maxmix.stopNames';

/** One thing a search found, as the search dialog lists it, and what picking it saves. */
export interface SearchResult<V = unknown> {
  /** Tells it apart from the other results. */
  key: string;
  name: string;
  /** The line under it: what stops there, or the place's region and country. */
  detail: string;
  /** A platform of the station before it, listed under it. */
  indent: boolean;
  value: V;
}

export type StopResult = SearchResult<DepartureStop>;
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

function fromStop(result: StopSearchResult): StopResult {
  return {
    key: stopKey(result.value),
    name: result.name,
    detail: result.subtitle,
    indent: result.indent,
    value: result.value
  };
}

function fromPlace(result: PlaceSearchResult): PlaceResult {
  return { key: result.id, name: result.name, detail: result.subtitle, indent: result.indent, value: result.value };
}

async function mockAnswers(): Promise<{ stops: StopSearchResult[]; places: PlaceSearchResult[] }> {
  const fixture = await import('../../vendor/countdown-api/src/countdown_api/fixtures/search.json');
  return fixture.default as unknown as { stops: StopSearchResult[]; places: PlaceSearchResult[] };
}

/** Stations and stops whose name has the words typed, best first. Rejects with SearchFailed when it can't search. */
export async function searchStops(query: string): Promise<StopResult[]> {
  if (import.meta.env.VITE_COUNTDOWN_CONFIG === 'mock') {
    const { stops } = await mockAnswers();
    return stops.map(result => fromStop(result));
  }
  const client = serverClient();
  if (!client) throw new SearchFailed();
  const answer = await searchStopsRoute(client, { q: query }).catch(() => null);
  if (!answer?.data) throw new SearchFailed();
  return answer.data.map(result => fromStop(result));
}

/** Towns and cities for the weather whose name has the words typed. Rejects with SearchFailed when it can't search. */
export async function searchPlaces(query: string): Promise<PlaceResult[]> {
  if (import.meta.env.VITE_COUNTDOWN_CONFIG === 'mock') {
    const { places } = await mockAnswers();
    return places.map(result => fromPlace(result));
  }
  const client = serverClient();
  if (!client) throw new SearchFailed();
  const answer = await searchPlacesRoute(client, { q: query }).catch(() => null);
  if (!answer?.data) throw new SearchFailed();
  return answer.data.map(result => fromPlace(result));
}

type StopNames = Record<string, { name: string; detail: string }>;

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
    names[result.key] = { name: result.name, detail: result.detail };
    localStorage.setItem(STOP_NAMES_KEY, JSON.stringify(names));
  } catch {
    // Storage is unavailable: the stop shows its id instead.
  }
}

/** A saved stop's name and the line under it, when this kiosk added it; otherwise its id stands in for the name. */
export function describeStop(stop: DepartureStop): { name: string; detail: string } {
  const source = stop.source === 'tfl' ? 'TfL' : 'Entur';
  const known = storedStopNames()[stopKey(stop)];
  return known
    ? { name: known.name, detail: known.detail ? `${known.detail} · ${source}` : source }
    : { name: stop.id, detail: source };
}
