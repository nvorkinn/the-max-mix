// Stop and place search for the Dashboard settings. The rework plan has countdown-server answer these (stops from TfL
// and Entur, places from Open-Meteo's geocoding), each in one result shape, for the website and the kiosk alike. Neither
// route is in countdown-api's contract yet, so this module answers from a short list of its own until they are; only its
// insides change then, not the shape the settings use.
// ASSUMPTION: the result shape below, and that the server will also say a saved stop's name (the config has only its
// source and id). The stops and places here are a stand-in list, not checked against TfL or Entur.

import type { DepartureStop } from 'countdown-api';

/** One thing a search found: a stop (source tfl or entur) or a place for the weather (source open-meteo). */
export interface SearchResult {
  source: DepartureStop['source'] | 'open-meteo';
  /** The stop's id at its source, or the place's weather key. */
  id: string;
  name: string;
  /** What tells it apart from others of the same name: a stop's direction or area, a place's region and country. */
  detail: string;
}

const STOPS: readonly SearchResult[] = [
  { source: 'tfl', id: '490000077E', name: 'Euston Station', detail: 'Stop E, towards Oxford Circus' },
  { source: 'tfl', id: '490000077F', name: 'Euston Station', detail: 'Stop F, towards Camden Town' },
  { source: 'tfl', id: '940GZZLUOVL', name: 'Oval Underground Station', detail: 'Northern line' },
  { source: 'tfl', id: '490000173RF', name: 'Oval', detail: 'Stop RF, towards Brixton' },
  { source: 'tfl', id: '940GZZLUKSX', name: "King's Cross St. Pancras Underground Station", detail: 'Six lines' },
  { source: 'entur', id: 'NSR:StopPlace:58366', name: 'Jernbanetorget', detail: 'Oslo' },
  { source: 'entur', id: 'NSR:StopPlace:58404', name: 'Nationaltheatret', detail: 'Oslo' },
  { source: 'entur', id: 'NSR:StopPlace:59872', name: 'Majorstuen', detail: 'Oslo' },
  { source: 'entur', id: 'NSR:StopPlace:337', name: 'Oslo S', detail: 'Oslo' },
  { source: 'entur', id: 'NSR:StopPlace:548', name: 'Bergen stasjon', detail: 'Bergen' }
];

const PLACES: readonly SearchResult[] = [
  { source: 'open-meteo', id: 'london-gb-2643743', name: 'London', detail: 'England, United Kingdom' },
  { source: 'open-meteo', id: 'manchester-gb-2643123', name: 'Manchester', detail: 'England, United Kingdom' },
  { source: 'open-meteo', id: 'edinburgh-gb-2650225', name: 'Edinburgh', detail: 'Scotland, United Kingdom' },
  { source: 'open-meteo', id: 'oslo-no-3143244', name: 'Oslo', detail: 'Oslo, Norway' },
  { source: 'open-meteo', id: 'bergen-no-3161732', name: 'Bergen', detail: 'Vestland, Norway' },
  { source: 'open-meteo', id: 'trondheim-no-3133880', name: 'Trondheim', detail: 'Trøndelag, Norway' }
];

function find(list: readonly SearchResult[], query: string): SearchResult[] {
  const wanted = query.trim().toLocaleLowerCase();
  return wanted ? list.filter(result => `${result.name} ${result.detail}`.toLocaleLowerCase().includes(wanted)) : [];
}

/** Stops whose name or area has the words typed. */
export function searchStops(query: string): Promise<SearchResult[]> {
  return Promise.resolve(find(STOPS, query));
}

/** Places for the weather whose name or region has the words typed. */
export function searchPlaces(query: string): Promise<SearchResult[]> {
  return Promise.resolve(find(PLACES, query));
}

/** A saved stop's name and area, when known; otherwise its id at its source stands in for the name. */
export function describeStop(stop: DepartureStop): { name: string; detail: string } {
  const known = STOPS.find(result => result.source === stop.source && result.id === stop.id);
  const source = stop.source === 'tfl' ? 'TfL' : 'Entur';
  return known ? { name: known.name, detail: `${known.detail} · ${source}` } : { name: stop.id, detail: source };
}
