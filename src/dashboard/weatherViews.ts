// The weather block's views (Now, Tomorrow, each with its hourly trend) and the outlook (props.ts) from the forecast
// countdown-server keeps for the kiosk's place: Open-Meteo's own answer, in the place's local time (utc_offset_seconds
// from UTC), which countdown-api leaves open, so the fields read here are checked here.

import type { DeviceWeather } from 'countdown-api';
import { DEFAULT_LANGUAGE } from '../i18n/language';
import type { Language } from '../i18n/language';
import type { StringId } from '../i18n/strings';
import { translate } from '../i18n/translate';
import type { DayForecast, HourForecast, Sky, WeatherView } from './props';

/** The trend's hours, and how many hours apart they are: on the place's even hours, the next one first. */
const TREND_HOURS = 3;
const TREND_STEP = 2;
/** Tomorrow's trend: its morning, midday and evening. */
const TOMORROW_HOURS: ReadonlySet<number> = new Set([8, 13, 18]);
/** Days in the outlook under the weather, from tomorrow. */
const OUTLOOK_DAYS = 5;

/** A WMO weather code as the sky it draws. */
export function skyFor(code: number): Sky {
  if (code <= 1) return 'clear';
  if (code === 2) return 'partly-cloudy';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code === 85 || code === 86 || (code >= 71 && code <= 77)) return 'snow';
  if (code >= 95) return 'thunder';
  return 'rain';
}

/** A WMO weather code's words' id. */
function conditionId(code: number): StringId {
  if (code === 0) return 'weather.clear';
  if (code === 1) return 'weather.mostly_clear';
  if (code === 2) return 'weather.partly_cloudy';
  if (code === 3) return 'weather.cloudy';
  if (code === 45 || code === 48) return 'weather.fog';
  if (code >= 51 && code <= 57) return 'weather.drizzle';
  if (code === 61 || code === 66) return 'weather.light_rain';
  if (code === 65 || code === 67) return 'weather.heavy_rain';
  if (code >= 71 && code <= 77) return 'weather.snow';
  if (code >= 80 && code <= 82) return 'weather.showers';
  if (code === 85 || code === 86) return 'weather.snow_showers';
  if (code >= 95) return 'weather.thunderstorms';
  return 'weather.rain';
}

/** A WMO weather code in words. */
export function conditionFor(code: number, language: Language = DEFAULT_LANGUAGE): string {
  return translate(conditionId(code), language);
}

/** The fields of Open-Meteo's answer read here. */
interface Fields {
  utc_offset_seconds: number;
  current: { time: string; temperature: number; weather_code: number };
  hourly: { time: string[]; temperature: number[]; weather_code: number[] };
  daily: { time: string[]; temperature_max: number[]; temperature_min: number[]; weather_code: number[] };
  sunrise: string[];
  sunset: string[];
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const listOf = <T>(value: unknown, item: (entry: unknown) => entry is T): T[] | null =>
  Array.isArray(value) && value.every(entry => item(entry)) ? value : null;

type Part = Partial<Record<string, unknown>>;

/** The hourly and daily series read here, or null when one is missing or of the wrong kind. */
function readSeries(hourly: Part, daily: Part): Pick<Fields, 'hourly' | 'daily'> | null {
  const hourTimes = listOf(hourly['time'], isText);
  const hourTemps = listOf(hourly['temperature'], isNumber);
  const hourCodes = listOf(hourly['weather_code'], isNumber);
  const days = listOf(daily['time'], isText);
  const highs = listOf(daily['temperature_max'], isNumber);
  const lows = listOf(daily['temperature_min'], isNumber);
  const dayCodes = listOf(daily['weather_code'], isNumber);
  if (!hourTimes || !hourTemps || !hourCodes || !days || !highs || !lows || !dayCodes) return null;
  return {
    hourly: { time: hourTimes, temperature: hourTemps, weather_code: hourCodes },
    daily: { time: days, temperature_max: highs, temperature_min: lows, weather_code: dayCodes }
  };
}

/** The forecast's fields read here, or null when one is missing or of the wrong kind. */
function readFields(forecast: Record<string, unknown>): Fields | null {
  const part = (name: string) => (forecast[name] ?? {}) as Part;
  const current = part('current');
  const daily = part('daily');
  const series = readSeries(part('hourly'), daily);
  const offset = forecast['utc_offset_seconds'];
  const [time, temperature, code] = [current['time'], current['temperature'], current['weather_code']];
  if (!series || !isText(time) || !isNumber(offset) || !isNumber(temperature) || !isNumber(code)) return null;
  return {
    ...series,
    utc_offset_seconds: offset,
    current: { time, temperature, weather_code: code },
    sunrise: listOf(daily['sunrise'], isText) ?? [],
    sunset: listOf(daily['sunset'], isText) ?? []
  };
}

interface Hour {
  /** Milliseconds since the epoch. */
  at: number;
  /** The place's local time, "2026-11-17T14:00". */
  local: string;
  temperature: number;
  code: number;
  sky: Sky;
}

const localHour = (hour: Hour) => Number(hour.local.slice(11, 13));
const localDate = (hour: Hour) => hour.local.slice(0, 10);

/** The place's local date a day after `date` ("2026-11-17" to "2026-11-18"). */
function nextDate(date: string, days = 1): string {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

export interface WeatherProps {
  views: WeatherView[];
  days: DayForecast[];
}

/**
 * The weather block's views and the outlook's days at `now`, in `language`, or null when the forecast is missing or
 * can't be read.
 */
export function toWeather(
  answer: DeviceWeather | null,
  now: Date,
  language: Language = DEFAULT_LANGUAGE
): WeatherProps | null {
  const stored = answer?.forecast;
  if (!stored) return null;
  const fields = readFields(stored.forecast);
  if (!fields) return null;
  const offsetMs = fields.utc_offset_seconds * 1000;
  // Open-Meteo's local times have no seconds ("2026-11-17T14:00").
  const toInstant = (local: string) => Date.parse(`${local.slice(0, 16)}:00Z`) - offsetMs;
  const hours: Hour[] = [];
  for (const [index, local] of fields.hourly.time.entries()) {
    const temperature = fields.hourly.temperature[index];
    const code = fields.hourly.weather_code[index];
    if (temperature !== undefined && code !== undefined) {
      hours.push({ at: toInstant(local), local, temperature, code, sky: skyFor(code) });
    }
  }
  const nowMs = now.getTime();
  // The hours still to come; the one under way counts as now.
  const ahead = hours.filter(hour => hour.at > nowMs);
  const today = new Date(nowMs + offsetMs).toISOString().slice(0, 10);
  const dayIndex = (date: string) => fields.daily.time.indexOf(date);

  const isDay = (hour: Hour): boolean => {
    const index = dayIndex(localDate(hour));
    const rise = fields.sunrise[index];
    const set = fields.sunset[index];
    return rise && set
      ? hour.at >= toInstant(rise) && hour.at < toInstant(set)
      : localHour(hour) >= 7 && localHour(hour) < 19;
  };

  const views: WeatherView[] = [];
  const toForecast = (hour: Hour): HourForecast => ({
    time: `${hour.local.slice(0, 13)}:00:00${offsetText(fields.utc_offset_seconds)}`,
    temperature: Math.round(hour.temperature),
    sky: hour.sky,
    isDay: isDay(hour)
  });

  // Now, and its next even hours.
  const nowSky = skyFor(fields.current.weather_code);
  const trend = ahead.filter(hour => localHour(hour) % TREND_STEP === 0).slice(0, TREND_HOURS);
  views.push({
    period: 'now',
    temperature: Math.round(fields.current.temperature),
    sky: nowSky,
    isDay: isDay({ at: nowMs, local: fields.current.time, temperature: 0, code: 0, sky: nowSky }),
    condition: conditionFor(fields.current.weather_code, language),
    hours: trend.map(hour => toForecast(hour))
  });

  // Tomorrow: its high and its own code, and its own hours.
  const tomorrow = nextDate(today);
  const tomorrowIndex = dayIndex(tomorrow);
  const tomorrowHigh = fields.daily.temperature_max[tomorrowIndex];
  const tomorrowCode = fields.daily.weather_code[tomorrowIndex];
  if (tomorrowHigh !== undefined && tomorrowCode !== undefined) {
    views.push({
      period: 'tomorrow',
      temperature: Math.round(tomorrowHigh),
      sky: skyFor(tomorrowCode),
      condition: conditionFor(tomorrowCode, language),
      hours: hours
        .filter(h => localDate(h) === tomorrow && TOMORROW_HOURS.has(localHour(h)))
        .map(hour => toForecast(hour))
    });
  }

  const days: DayForecast[] = [];
  for (let offset = 1; offset <= OUTLOOK_DAYS; offset += 1) {
    const date = nextDate(today, offset);
    const index = dayIndex(date);
    const high = fields.daily.temperature_max[index];
    const low = fields.daily.temperature_min[index];
    const code = fields.daily.weather_code[index];
    if (high === undefined || low === undefined || code === undefined) break;
    days.push({ date, high: Math.round(high), low: Math.round(low), sky: skyFor(code) });
  }
  return { views, days };
}

/** An offset from UTC as ISO writes it: "+01:00", "Z" for none. */
function offsetText(seconds: number): string {
  if (seconds === 0) return 'Z';
  const sign = seconds < 0 ? '-' : '+';
  const minutes = Math.abs(seconds) / 60;
  return `${sign}${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
