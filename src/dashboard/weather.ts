// The Dashboard's weather, real: the place in the kiosk's config, the conditions now and the next few hours. countdown-api
// has no route that gives a touchscreen its weather yet (countdown-server keeps it in v1:weather:<key>, which only its
// renderers read), so for now the kiosk asks Open-Meteo itself, the same free service the server uses. getWeather is the
// only way in: when the server answers the weather, only this file changes. The Dashboard still shows data.ts's made-up
// weather until its layout is settled.

import type { TouchscreenConfig } from 'countdown-api';
import { debugLog } from '../utils/debugLog';
import { errorMessage } from '../utils/errorMessage';

export type Conditions = 'clear' | 'partly-cloudy' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunder';

interface HourForecast {
  /** The start of the hour, as an ISO time. */
  time: string;
  /** Degrees Celsius, whole. */
  temperature: number;
  conditions: Conditions;
  /** Whether the sun is up then. */
  daylight: boolean;
}

export interface Weather {
  /** When the weather was read, as an ISO time. */
  updatedAt: string;
  /** The place as the owner named it. */
  location: string;
  /** Degrees Celsius, whole. */
  temperature: number;
  conditions: Conditions;
  /** Whether the sun is up now. */
  daylight: boolean;
  /** The coming hours, soonest first. */
  hours: HourForecast[];
  /** A picture of the place's day to show behind the weather, or null for the plain sky. */
  background: string | null;
}

type WeatherSection = TouchscreenConfig['weather'];

/** How long a reading is used before Open-Meteo is asked again; it updates its forecast every 15 minutes. */
const READING_MS = 10 * 60_000;
/** How long after a failed read the kiosk waits to try again. */
const RETRY_MS = 60_000;
/** Hours asked for: the current one and the next few, of which the Dashboard shows three or four. */
const FORECAST_HOURS = 6;

const GEOCODING = 'https://geocoding-api.open-meteo.com/v1';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';

/** WMO weather codes, as Open-Meteo answers them, to the conditions the Dashboard draws. */
export function conditionsFor(code: number): Conditions {
  if (code <= 1) return 'clear';
  if (code === 2) return 'partly-cloudy';
  if (code === 3) return 'cloudy';
  if (code === 48 || code === 45) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code === 85 || code === 86 || (code >= 71 && code <= 77)) return 'snow';
  if (code >= 95) return 'thunder';
  return 'rain';
}

/**
 * The Open-Meteo id in a weather key for a place picked from the search (london-gb-2643743, jp-1850147), or null for a
 * typed location's key (london, oslo-0150).
 */
export function placeId(key: string): number | null {
  const match = /^(?:.*-)?[a-z]{2}-(\d+)$/.exec(key);
  return match ? Number(match[1]) : null;
}

interface Place {
  latitude: number;
  longitude: number;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
  return (await response.json()) as T;
}

// Places don't move: each key is looked up once.
const places = new Map<string, Promise<Place>>();

/** Where a weather key is: by its Open-Meteo id, or for a typed location the place Open-Meteo finds first by name. */
function findPlace(section: { location: string; key: string }): Promise<Place> {
  let place = places.get(section.key);
  if (!place) {
    const id = placeId(section.key);
    place = (
      id === null
        ? getJson<{ results?: Place[] }>(
            `${GEOCODING}/search?${new URLSearchParams({ name: section.location.trim(), count: '1' })}`
          ).then(answer => {
            const first = answer.results?.[0];
            if (!first) throw new Error(`Open-Meteo knows no place called ${section.location}`);
            return first;
          })
        : getJson<Place>(`${GEOCODING}/get?id=${id}`)
    ).then(({ latitude, longitude }) => ({ latitude, longitude }));
    // A failed lookup is tried again next time.
    place.catch(() => places.delete(section.key));
    places.set(section.key, place);
  }
  return place;
}

interface Forecast {
  current: { time: number; temperature_2m: number; weather_code: number; is_day: number };
  hourly: { time: number[]; temperature_2m: number[]; weather_code: number[]; is_day: number[] };
}

async function readWeather(section: { location: string; key: string }, now: Date): Promise<Weather> {
  const { latitude, longitude } = await findPlace(section);
  const query = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,weather_code,is_day',
    hourly: 'temperature_2m,weather_code,is_day',
    forecast_hours: String(FORECAST_HOURS),
    timeformat: 'unixtime',
    timezone: 'auto'
  });
  const { current, hourly } = await getJson<Forecast>(`${FORECAST}?${query}`);
  const hours = hourly.time
    .map((time, index) => ({
      time: new Date(time * 1000).toISOString(),
      temperature: Math.round(hourly.temperature_2m[index] ?? NaN),
      conditions: conditionsFor(hourly.weather_code[index] ?? 0),
      daylight: hourly.is_day[index] === 1
    }))
    .filter(hour => Date.parse(hour.time) > now.getTime() && Number.isFinite(hour.temperature));
  return {
    updatedAt: now.toISOString(),
    location: section.location,
    temperature: Math.round(current.temperature_2m),
    conditions: conditionsFor(current.weather_code),
    daylight: current.is_day === 1,
    hours,
    background: null
  };
}

// The last reading, and when the kiosk last tried: one place at a time, the kiosk's own.
let last: {
  key: string;
  weather: Weather | null;
  triedAt: number;
  pending?: Promise<Weather | null> | undefined;
} | null = null;

/**
 * The weather for the config's place, or null with no place set or none read yet. A reading is used for ten minutes;
 * when a new one fails the last one stays (the Dashboard stops showing it once it is too old) and the kiosk tries again
 * a minute later.
 */
export function getWeather(section: WeatherSection | null | undefined, now = new Date()): Promise<Weather | null> {
  const key = section?.key;
  if (!section || !key) return Promise.resolve(null);
  if (last?.key !== key) last = { key, weather: null, triedAt: -Infinity };
  const entry = last;
  if (entry.pending) return entry.pending;
  const age = now.getTime() - entry.triedAt;
  if (age < (entry.weather ? READING_MS : RETRY_MS)) {
    return Promise.resolve(entry.weather && { ...entry.weather, location: section.location });
  }
  entry.triedAt = now.getTime();
  entry.pending = (async () => {
    try {
      entry.weather = await readWeather({ location: section.location, key }, now);
    } catch (caught) {
      debugLog('error', 'weather', `Could not read the weather: ${errorMessage(caught)}`);
      // Wait a minute, not ten, before the next try.
      entry.triedAt = now.getTime() - READING_MS + RETRY_MS;
    } finally {
      entry.pending = undefined;
    }
    return entry.weather;
  })();
  return entry.pending;
}

/** Forgets the readings and places (for tests). */
export function forgetWeather(): void {
  last = null;
  places.clear();
}
