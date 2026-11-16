// The Dashboard's weather, from countdown-server: the weather now and the next hours for the place in the kiosk's
// config, and the day's background picture for it. The server reads the weather (Open-Meteo) and makes the picture;
// the kiosk only asks it, with its device secret, at GET /api/devices/weather.
//
// That route isn't in countdown-api's contract yet, so the answer's shape (DeviceWeather) is written out here as the
// kiosk needs it; once the contract has it, its generated type and client function replace these. getWeather is the
// only way in.

import { serverClient } from '../countdown/config';
import { debugLog } from '../utils/debugLog';
import { errorMessage } from '../utils/errorMessage';

/** The weather at one time, as the server answers it. */
interface DeviceWeatherReading {
  /** Degrees Celsius. */
  temperature: number;
  /** The WMO weather code, as Open-Meteo answers it. */
  weather_code: number;
  /** Whether the sun is up. */
  is_day: boolean;
}

/** GET /api/devices/weather's answer: the weather for the place in the device's config. */
export interface DeviceWeather {
  /** The place as the owner named it (the config's weather.location). */
  location: string;
  /** The config's weather.key this is for. */
  key: string;
  /** When the server read the weather from its provider, as an ISO time. */
  updated_at: string;
  /** Now. */
  current: DeviceWeatherReading;
  /** The coming hours, soonest first, each from the start of its hour (ISO time); at least the next six. */
  hours: (DeviceWeatherReading & { time: string })[];
  /**
   * The day's background picture for the place (landscape, no text, a calm top-left), or null while there is none. Its
   * URL is public and content-hashed: an <img> or CSS background can't send the device secret.
   */
  background: {
    /** The place's local day it is for, as YYYY-MM-DD. */
    date: string;
    url: string;
    generated_at: string;
    /** Whether it is a curated stand-in because the day's picture couldn't be made. */
    fallback: boolean;
    width: number;
    height: number;
  } | null;
}

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
  /** A picture of the place's day to show behind the weather, or null for the plain sky. */
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

/** The server's answer as the Dashboard draws it, with only the hours still to come at `now`. */
function toWeather(answer: DeviceWeather, now: Date): Weather {
  return {
    updatedAt: answer.updated_at,
    location: answer.location,
    temperature: Math.round(answer.current.temperature),
    conditions: conditionsFor(answer.current.weather_code),
    daylight: answer.current.is_day,
    hours: answer.hours
      .filter(hour => Date.parse(hour.time) > now.getTime())
      .map(hour => ({
        time: hour.time,
        temperature: Math.round(hour.temperature),
        conditions: conditionsFor(hour.weather_code),
        daylight: hour.is_day
      })),
    background: answer.background?.url ?? null
  };
}

/**
 * The weather for the place in the kiosk's config, or null when the kiosk isn't registered, has no place set (the
 * server answers 204), or the server can't be reached or has no reading yet. A failed read is logged; the Dashboard
 * keeps the last weather it had until that is too old.
 */
export async function getWeather(now = new Date()): Promise<Weather | null> {
  const server = serverClient();
  if (!server) return null;
  try {
    const response = await fetch(`${server.baseUrl}/api/devices/weather`, {
      headers: { Authorization: `Bearer ${server.secret}` }
    });
    if (response.status === 204) return null;
    if (!response.ok) throw new Error(`countdown-server answered ${response.status}`);
    return toWeather((await response.json()) as DeviceWeather, now);
  } catch (caught) {
    debugLog('error', 'weather', `Could not read the weather: ${errorMessage(caught)}`);
    return null;
  }
}
