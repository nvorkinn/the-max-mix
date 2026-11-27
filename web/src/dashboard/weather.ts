// The Dashboard's weather, from countdown-server: getWeather (GET /api/devices/weather, with the device secret) answers
// the config's place and the forecast the server keeps for it, which is Open-Meteo's own answer (times in the place's
// local time, utc_offset_seconds from UTC). countdown-api leaves that answer's insides open, so the kiosk reads them
// with its own model of Open-Meteo's fields below. getWeather here is the only way in.

import type { DeviceWeather } from 'countdown-api';
import { getWeather as getDeviceWeather } from '../../../vendor/countdown-api/src/countdown_api/client';
import { serverClient } from '../countdown/config';
import { debugLog } from '../utils/debugLog';
import { errorMessage } from '../utils/errorMessage';

/** The kinds of weather the Dashboard draws. */
export type Conditions = 'clear' | 'partly-cloudy' | 'cloudy' | 'rain' | 'snow';

interface HourForecast {
  /** The start of the hour, as an ISO time. */
  time: string;
  /** Degrees Celsius, whole. */
  temperature: number;
  conditions: Conditions;
}

/** The weather as the Dashboard draws it. */
export interface Weather {
  /** When the server read the weather, as an ISO time. */
  updatedAt: string;
  /** The place as the owner named it. */
  location: string;
  /** Degrees Celsius, whole. */
  temperature: number;
  conditions: Conditions;
  /** Today's highest and lowest, in the place's day. */
  high: number;
  low: number;
  /** The coming hours, soonest first. */
  hours: HourForecast[];
}

/** Hours of forecast kept: the Dashboard shows three, and says whether rain comes in these. */
const FORECAST_HOURS = 6;

/** WMO weather codes to the kinds the Dashboard draws: fog with the clouds, drizzle and thunder with the rain. */
export function conditionsFor(code: number): Conditions {
  if (code <= 1) return 'clear';
  if (code === 2) return 'partly-cloudy';
  if ([3, 45, 48].includes(code)) return 'cloudy';
  if (code === 85 || code === 86 || (code >= 71 && code <= 77)) return 'snow';
  return 'rain';
}

/** The fields of Open-Meteo's answer the Dashboard reads, as countdown-server fetches it. */
interface OpenMeteoFields {
  current: { time: string; temperature: number; weather_code: number };
  hourly: { time: string[]; temperature: number[]; weather_code: number[] };
  daily: { time: string[]; temperature_max: number[]; temperature_min: number[] };
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const isList = <T>(value: unknown, item: (entry: unknown) => entry is T): value is T[] =>
  Array.isArray(value) && value.every(entry => item(entry));

/** Whether the forecast has the fields the Dashboard reads, each of the right kind. */
function hasFields(forecast: { current: object; hourly: object; daily: object }): forecast is OpenMeteoFields {
  const current = forecast.current as Partial<Record<string, unknown>>;
  const hourly = forecast.hourly as Partial<Record<string, unknown>>;
  const daily = forecast.daily as Partial<Record<string, unknown>>;
  return (
    isText(current['time']) &&
    isNumber(current['temperature']) &&
    isNumber(current['weather_code']) &&
    isList(hourly['time'], isText) &&
    isList(hourly['temperature'], isNumber) &&
    isList(hourly['weather_code'], isNumber) &&
    isList(daily['time'], isText) &&
    isList(daily['temperature_max'], isNumber) &&
    isList(daily['temperature_min'], isNumber)
  );
}

/** The place's local time (2026-01-15T12:00, no offset) as milliseconds since the epoch. */
function placeTime(local: string, utcOffsetSeconds: number): number {
  return Date.parse(`${local}Z`) - utcOffsetSeconds * 1000;
}

/** The server's answer as the Dashboard draws it at `now`, or null when it has no forecast for today. */
export function toWeather(answer: DeviceWeather, now: Date): Weather | null {
  const stored = answer.forecast;
  if (!stored) return null;
  const { forecast } = stored;
  if (!hasFields(forecast)) throw new Error('the forecast is missing fields');
  const offset = forecast.utc_offset_seconds;
  // Today is the place's day now: the date of the current reading's local time.
  const today = forecast.daily.time.indexOf(forecast.current.time.slice(0, 10));
  const high = forecast.daily.temperature_max[today];
  const low = forecast.daily.temperature_min[today];
  if (high === undefined || low === undefined) return null;
  const hours = forecast.hourly.time
    .flatMap((local, index) => {
      const time = placeTime(local, offset);
      const temperature = forecast.hourly.temperature[index];
      const code = forecast.hourly.weather_code[index];
      if (temperature === undefined || code === undefined || time <= now.getTime()) return [];
      const hour: HourForecast = {
        time: new Date(time).toISOString(),
        temperature: Math.round(temperature),
        conditions: conditionsFor(code)
      };
      return [hour];
    })
    .slice(0, FORECAST_HOURS);
  return {
    updatedAt: stored.fetched_at,
    location: answer.location,
    temperature: Math.round(forecast.current.temperature),
    conditions: conditionsFor(forecast.current.weather_code),
    high: Math.round(high),
    low: Math.round(low),
    hours
  };
}

// The last weather read, which stays when a read fails; the Dashboard stops showing it once it is too old.
let last: Weather | null = null;

/**
 * The weather for the place in the kiosk's config, or null when the kiosk isn't registered or owned, has no place set
 * or no forecast for it yet. When the server can't be reached or refuses, the failure is logged and the last weather
 * read stands in.
 */
export async function getWeather(now = new Date()): Promise<Weather | null> {
  const server = serverClient();
  if (!server) return null;
  try {
    const { data, response } = await getDeviceWeather(server);
    // 401 and 409: the server doesn't know the kiosk, or nobody owns it, so there's no place to have weather for.
    if (response.status === 401 || response.status === 409) last = null;
    else if (data) last = toWeather(data, now);
    else throw new Error(`countdown-server answered ${response.status}`);
  } catch (caught) {
    debugLog('error', 'weather', `Could not read the weather: ${errorMessage(caught)}`);
  }
  return last;
}

/** Forgets the last weather read (for tests). */
export function forgetWeather(): void {
  last = null;
}
