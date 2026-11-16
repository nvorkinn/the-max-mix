// The Dashboard's weather, from countdown-server: getWeather (GET /api/devices/weather, with the device secret) answers
// the config's place and the forecast the server keeps for it, which is Open-Meteo's own answer (times in the place's
// local time, utc_offset_seconds from UTC). countdown-api leaves that answer's insides open, so the kiosk reads them
// with its own model of Open-Meteo's fields below. getWeather here is the only way in.

import type { DeviceWeather } from 'countdown-api';
import { getWeather as getDeviceWeather } from '../../vendor/countdown-api/src/countdown_api/client';
import { serverClient } from '../countdown/config';
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

/** The weather as the Dashboard draws it. */
export interface Weather {
  /** When the server read the weather, as an ISO time. */
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
  /** A picture of the place's day to show behind the weather, or null for the plain sky. countdown-api has none yet. */
  background: string | null;
}

/** WMO weather codes to the conditions the Dashboard draws. */
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

/** The fields of Open-Meteo's answer the Dashboard reads, as countdown-server fetches it. */
interface OpenMeteoFields {
  current: { temperature: number; weather_code: number; is_day: boolean };
  hourly: { time: string[]; temperature: number[]; weather_code: number[] };
  daily: { time: string[]; sunrise: string[]; sunset: string[] };
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isList = <T>(value: unknown, item: (entry: unknown) => entry is T): value is T[] =>
  Array.isArray(value) && value.every(entry => item(entry));
const isText = (value: unknown): value is string => typeof value === 'string';

/** Whether the forecast has the fields the Dashboard reads, each of the right kind. */
function hasFields(forecast: { current: object; hourly: object; daily: object }): forecast is OpenMeteoFields {
  const current = forecast.current as Partial<Record<string, unknown>>;
  const hourly = forecast.hourly as Partial<Record<string, unknown>>;
  const daily = forecast.daily as Partial<Record<string, unknown>>;
  return (
    isNumber(current['temperature']) &&
    isNumber(current['weather_code']) &&
    typeof current['is_day'] === 'boolean' &&
    isList(hourly['time'], isText) &&
    isList(hourly['temperature'], isNumber) &&
    isList(hourly['weather_code'], isNumber) &&
    isList(daily['time'], isText) &&
    isList(daily['sunrise'], isText) &&
    isList(daily['sunset'], isText)
  );
}

/** The place's local time (2026-01-15T12:00, no offset) as milliseconds since the epoch. */
function placeTime(local: string, utcOffsetSeconds: number): number {
  return Date.parse(`${local}Z`) - utcOffsetSeconds * 1000;
}

/** The server's answer as the Dashboard draws it at `now`, or null when it has no forecast. */
export function toWeather(answer: DeviceWeather, now: Date): Weather | null {
  const stored = answer.forecast;
  if (!stored) return null;
  const { forecast } = stored;
  if (!hasFields(forecast)) throw new Error('the forecast is missing fields');
  const offset = forecast.utc_offset_seconds;
  // Each day's daylight, from its sunrise to its sunset, for the hours' day and night.
  const days = forecast.daily.time.map((_, index) => ({
    sunrise: placeTime(forecast.daily.sunrise[index] ?? '', offset),
    sunset: placeTime(forecast.daily.sunset[index] ?? '', offset)
  }));
  const isDaylight = (time: number) => days.some(day => time >= day.sunrise && time < day.sunset);
  const hours = forecast.hourly.time.flatMap((local, index) => {
    const time = placeTime(local, offset);
    const temperature = forecast.hourly.temperature[index];
    const code = forecast.hourly.weather_code[index];
    if (temperature === undefined || code === undefined || time <= now.getTime()) return [];
    const hour: HourForecast = {
      time: new Date(time).toISOString(),
      temperature: Math.round(temperature),
      conditions: conditionsFor(code),
      daylight: isDaylight(time)
    };
    return [hour];
  });
  return {
    updatedAt: stored.fetched_at,
    location: answer.location,
    temperature: Math.round(forecast.current.temperature),
    conditions: conditionsFor(forecast.current.weather_code),
    daylight: forecast.current.is_day,
    hours,
    background: null
  };
}

/**
 * The weather for the place in the kiosk's config, or null when the kiosk isn't registered, has no place set or no
 * forecast for it yet, or the server can't be reached or refuses. A failed read is logged; the Dashboard keeps the last
 * weather it had until that is too old.
 */
export async function getWeather(now = new Date()): Promise<Weather | null> {
  const server = serverClient();
  if (!server) return null;
  try {
    const { data, response } = await getDeviceWeather(server);
    if (!data) throw new Error(`countdown-server answered ${response.status}`);
    return toWeather(data, now);
  } catch (caught) {
    debugLog('error', 'weather', `Could not read the weather: ${errorMessage(caught)}`);
    return null;
  }
}
