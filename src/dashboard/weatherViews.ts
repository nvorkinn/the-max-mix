// The weather block's views (Now, Tonight, Tomorrow, Weekend) and the hourly strip's hours (props.ts) from the forecast
// countdown-server keeps for the kiosk's place: Open-Meteo's own answer, in the place's local time (utc_offset_seconds
// from UTC), which countdown-api leaves open, so the fields read here are checked here.
//
// Each view's summary says only what the hourly strip doesn't (it shows the next STRIP_HOURS): when rain comes or goes
// later today, when it starts tomorrow, or which weekend day is wet. With nothing like that to say there is none.

import type { DeviceWeather } from 'countdown-api';
import { DEFAULT_LANGUAGE } from '../i18n/language';
import type { Language } from '../i18n/language';
import type { StringId } from '../i18n/strings';
import { translate } from '../i18n/translate';
import type { ClockFormat } from '../utils/clockFormat';
import type { DayForecast, HourForecast, Sky, WeatherView } from './props';

/** Hours the strip shows. */
const STRIP_HOURS = 5;
/** Hours handed to the strip, so it still has five as the hour turns before the next forecast. */
const HOURS_KEPT = 8;
/** Days in the outlook under the weather, from tomorrow. */
const OUTLOOK_DAYS = 5;
/** Tonight runs from this hour (or now, if later) to MORNING the next day. */
const EVENING = 18;
const MORNING = 6;
/** The waking hours a day's summary is about. */
const DAY_FROM = 7;
const DAY_TO = 21;

/** Each sky, worst last: a period that has several shows its worst wet one. */
const SKIES: readonly Sky[] = ['clear', 'partly-cloudy', 'cloudy', 'fog', 'drizzle', 'rain', 'snow', 'thunder'];
const WET: ReadonlySet<Sky> = new Set(['drizzle', 'rain', 'snow', 'thunder']);

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

const SKY_WORDS: Record<Sky, StringId> = {
  clear: 'weather.clear',
  'partly-cloudy': 'weather.partly_cloudy',
  cloudy: 'weather.cloudy',
  fog: 'weather.fog',
  drizzle: 'weather.drizzle',
  rain: 'weather.rain',
  snow: 'weather.snow',
  thunder: 'weather.thunderstorms'
};

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

/** An hour of the place's local time as the clock format writes it: "1pm" or "13:00". */
function hourWords(hour: number, clockFormat: ClockFormat): string {
  if (clockFormat === '24h') return `${String(hour).padStart(2, '0')}:00`;
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${hour < 12 ? 'am' : 'pm'}`;
}

/** The sky of a run of hours: their worst wet one if a quarter or more are wet, else the commonest dry one. */
function skyOf(hours: readonly Hour[]): Sky {
  const wet = hours.filter(hour => WET.has(hour.sky));
  if (wet.length > 0 && wet.length * 4 >= hours.length) {
    let worst: Sky = 'drizzle';
    for (const hour of wet) if (SKIES.indexOf(hour.sky) > SKIES.indexOf(worst)) worst = hour.sky;
    return worst;
  }
  const counts = new Map<Sky, number>();
  for (const hour of hours) counts.set(hour.sky, (counts.get(hour.sky) ?? 0) + 1);
  let commonest: Sky = 'clear';
  for (const [sky, count] of counts) {
    const best = counts.get(commonest) ?? 0;
    if (count > best || (count === best && SKIES.indexOf(sky) > SKIES.indexOf(commonest))) commonest = sky;
  }
  return commonest;
}

/** A view's summary, and whether it says it stays or turns dry. */
interface Summary {
  text: string;
  dry: boolean;
}

/** "Rain from 3pm" for the first wet hour of `hours` after a dry one, "Dry from 7pm" for the reverse; else null. */
function turnOf(hours: readonly Hour[], wetNow: boolean, clockFormat: ClockFormat, language: Language): Summary | null {
  const turn = hours.find(hour => WET.has(hour.sky) !== wetNow);
  if (!turn) return null;
  const hour = hourWords(localHour(turn), clockFormat);
  return { text: translate(wetNow ? 'weather.dry_from' : 'weather.rain_from', language, { hour }), dry: wetNow };
}

/** A summary with its icon: a sun for one that says it stays or turns dry, else the umbrella. */
function withIcon(summary: Summary | null): Pick<WeatherView, 'summary' | 'summaryIcon'> {
  if (!summary) return { summary: null };
  return summary.dry ? { summary: summary.text, summaryIcon: 'sun' } : { summary: summary.text };
}

export interface WeatherProps {
  views: WeatherView[];
  hours: HourForecast[];
  days: DayForecast[];
}

/**
 * The weather block's views and the strip's hours at `now`, in `language`, or null when the forecast is missing or
 * can't be read.
 */
export function toWeather(
  answer: DeviceWeather | null,
  now: Date,
  clockFormat: ClockFormat,
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

  // Now: what the strip doesn't show is the rest of today after it.
  const nowSky = skyFor(fields.current.weather_code);
  const laterToday = ahead.slice(STRIP_HOURS).filter(hour => localDate(hour) === today);
  const strip = ahead.slice(0, STRIP_HOURS);
  const wetBy = (from: readonly Hour[]) => WET.has(from.at(-1)?.sky ?? nowSky);
  const nowSummary = turnOf(laterToday, wetBy(strip), clockFormat, language);
  views.push({
    period: 'now',
    temperature: Math.round(fields.current.temperature),
    sky: nowSky,
    isDay: isDay({ at: nowMs, local: fields.current.time, temperature: 0, code: 0, sky: nowSky }),
    condition: conditionFor(fields.current.weather_code, language),
    ...withIcon(nowSummary)
  });

  // Tonight: from EVENING (or now) to MORNING tomorrow.
  const at = (date: string, hour: number) => toInstant(`${date}T${String(hour).padStart(2, '0')}:00`);
  const placeNow = new Date(nowMs + offsetMs);
  const small = placeNow.getUTCHours() < MORNING;
  const endsAt = at(small ? today : nextDate(today), MORNING);
  const startsAt = small ? nowMs : Math.max(nowMs, at(today, EVENING));
  const night = hours.filter(hour => hour.at >= startsAt && hour.at < endsAt);
  if (night.length > 0) {
    const sky = skyOf(night);
    const low = Math.min(...night.map(hour => hour.temperature));
    views.push({
      period: 'tonight',
      temperature: Math.round(low),
      sky,
      isDay: false,
      condition: translate(SKY_WORDS[sky], language),
      summary: null
    });
  }

  // Tomorrow: its high and its own code, and when rain starts in its waking hours.
  const tomorrow = nextDate(today);
  const tomorrowIndex = dayIndex(tomorrow);
  const tomorrowHigh = fields.daily.temperature_max[tomorrowIndex];
  const tomorrowCode = fields.daily.weather_code[tomorrowIndex];
  if (tomorrowHigh !== undefined && tomorrowCode !== undefined) {
    const waking = hours.filter(h => localDate(h) === tomorrow && localHour(h) >= DAY_FROM && localHour(h) <= DAY_TO);
    const firstWet = waking.find(hour => WET.has(hour.sky));
    const dry = waking.length > 0 && !firstWet && !WET.has(skyFor(tomorrowCode));
    let tomorrowSummary: Summary | null = null;
    if (firstWet) {
      const hour = hourWords(localHour(firstWet), clockFormat);
      tomorrowSummary = { text: translate('weather.rain_from', language, { hour }), dry: false };
    } else if (dry) tomorrowSummary = { text: translate('weather.dry_all_day', language), dry: true };
    views.push({
      period: 'tomorrow',
      temperature: Math.round(tomorrowHigh),
      sky: skyFor(tomorrowCode),
      condition: conditionFor(tomorrowCode, language),
      ...withIcon(tomorrowSummary)
    });
  }

  // The weekend: the coming Saturday and Sunday, while today isn't one of them (Tomorrow says Sunday on a Saturday).
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  if (weekday >= 1 && weekday <= 5) {
    const saturday = nextDate(today, 6 - weekday);
    const days = [saturday, nextDate(saturday)].map(date => {
      const index = dayIndex(date);
      const high = fields.daily.temperature_max[index];
      const code = fields.daily.weather_code[index];
      return high === undefined || code === undefined ? null : { high, code, sky: skyFor(code) };
    });
    const [sat, sun] = days;
    if (sat && sun) {
      const worse = SKIES.indexOf(sun.sky) > SKIES.indexOf(sat.sky) ? sun : sat;
      const wetSat = WET.has(sat.sky);
      const wetSun = WET.has(sun.sky);
      const wetDay = wetSat ? 'weather.rain_saturday' : 'weather.rain_sunday';
      views.push({
        period: 'weekend',
        temperature: Math.round(Math.max(sat.high, sun.high)),
        sky: worse.sky,
        condition: conditionFor(worse.code, language),
        summary: wetSat === wetSun ? null : translate(wetDay, language)
      });
    }
  }

  const stripHours: HourForecast[] = ahead.slice(0, HOURS_KEPT).map(hour => ({
    time: `${hour.local.slice(0, 13)}:00:00${offsetText(fields.utc_offset_seconds)}`,
    temperature: Math.round(hour.temperature),
    sky: hour.sky,
    isDay: isDay(hour)
  }));
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
  return { views, hours: stripHours, days };
}

/** An offset from UTC as ISO writes it: "+01:00", "Z" for none. */
function offsetText(seconds: number): string {
  if (seconds === 0) return 'Z';
  const sign = seconds < 0 ? '-' : '+';
  const minutes = Math.abs(seconds) / 60;
  return `${sign}${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
