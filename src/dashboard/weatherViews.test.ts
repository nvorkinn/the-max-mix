import { describe, expect, it } from 'vitest';
import type { DeviceWeather } from 'countdown-api';
import { translate } from '../i18n/translate';
import { conditionFor, skyFor, toWeather } from './weatherViews';

// Tuesday 17 November 2026, 09:20 in London (UTC, so the place's local time is UTC too).
const NOW = new Date('2026-11-17T09:20:00Z');
const DAYS = ['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23'];

interface Options {
  /** Local "YYYY-MM-DDTHH" to a weather code; partly cloudy otherwise. */
  codes?: Record<string, number>;
  /** Each day's code, by date; partly cloudy otherwise. */
  dayCodes?: Record<string, number>;
  offsetSeconds?: number;
}

/** A week of Open-Meteo forecast as countdown-server stores it: 8 at night, 12 by day, sunrise 07:00, sunset 16:00. */
function answer({ codes = {}, dayCodes = {}, offsetSeconds = 0 }: Options = {}): DeviceWeather {
  const time = DAYS.flatMap(day =>
    Array.from({ length: 24 }, (_, hour) => `${day}T${String(hour).padStart(2, '0')}:00`)
  );
  return {
    location: 'London',
    key: 'london-gb-2643743',
    background: null,
    forecast: {
      fetched_at: '2026-11-17T09:15:00Z',
      location: 'London',
      forecast: {
        utc_offset_seconds: offsetSeconds,
        current: { time: '2026-11-17T09:15', temperature: 9.4, weather_code: 2, is_day: true },
        hourly: {
          time,
          temperature: time.map(t => (Number(t.slice(11, 13)) >= 7 && Number(t.slice(11, 13)) < 18 ? 12 : 8)),
          weather_code: time.map(t => codes[t.slice(0, 13)] ?? 2)
        },
        daily: {
          time: DAYS,
          temperature_max: DAYS.map((_, index) => 12 + index),
          temperature_min: DAYS.map(() => 5),
          weather_code: DAYS.map(day => dayCodes[day] ?? 2),
          sunrise: DAYS.map(day => `${day}T07:00`),
          sunset: DAYS.map(day => `${day}T16:00`)
        }
      }
    }
  } as unknown as DeviceWeather;
}

describe('toWeather', () => {
  it('rotates Now and Tomorrow, each with its own temperature', () => {
    const weather = toWeather(answer(), NOW, '24h');

    expect(weather?.views.map(view => [view.period, view.temperature, view.sky, view.condition])).toEqual([
      ['now', 9, 'partly-cloudy', 'Partly cloudy'],
      ['tomorrow', 13, 'partly-cloudy', 'Partly cloudy']
    ]);
  });

  it("says when rain comes later today only past the trend's hours", () => {
    const rainLater = toWeather(answer({ codes: { '2026-11-17T16': 61, '2026-11-17T17': 61 } }), NOW, '12h');
    const rainSoon = toWeather(answer({ codes: { '2026-11-17T12': 61 } }), NOW, '12h');

    expect(rainLater?.views[0]?.summary).toBe('Rain from 4pm');
    expect(toWeather(answer({ codes: { '2026-11-17T16': 61 } }), NOW, '24h')?.views[0]?.summary).toBe(
      'Rain from 16:00'
    );
    // The trend already shows it.
    expect(rainSoon?.views[0]?.summary).toBeNull();
  });

  it('says when it dries up, when it is still raining at the end of the trend', () => {
    const codes: Record<string, number> = {};
    for (let hour = 9; hour < 19; hour += 1) codes[`2026-11-17T${String(hour).padStart(2, '0')}`] = 63;

    expect(toWeather(answer({ codes }), NOW, '12h')?.views[0]?.summary).toBe('Dry from 7pm');
  });

  it("gives tomorrow's rain hour, or says it stays dry", () => {
    const wet = answer({ codes: { '2026-11-18T14': 80 }, dayCodes: { '2026-11-18': 80 } });

    expect(toWeather(wet, NOW, '12h')?.views[1]).toMatchObject({
      sky: 'rain',
      condition: 'Showers',
      summary: 'Rain from 2pm'
    });
    expect(toWeather(answer(), NOW, '12h')?.views[1]?.summary).toBe('Dry all day');
  });

  it('says it all in Norwegian, with the dry summaries still under a sun', () => {
    const codes: Record<string, number> = {};
    for (let hour = 9; hour < 19; hour += 1) codes[`2026-11-17T${String(hour).padStart(2, '0')}`] = 63;
    const views = toWeather(answer({ codes }), NOW, '24h', 'nb')?.views ?? [];

    expect(views[0]).toMatchObject({
      condition: translate('weather.partly_cloudy', 'nb'),
      summary: translate('weather.dry_from', 'nb', { hour: '19:00' }),
      summaryIcon: 'sun'
    });
    expect(views[1]).toMatchObject({ summary: translate('weather.dry_all_day', 'nb'), summaryIcon: 'sun' });
  });

  it("gives the next three even hours, in the place's offset, with day and night from sunrise and sunset", () => {
    const at = (utc: string) => toWeather(answer({ offsetSeconds: 3600 }), new Date(utc), '24h')?.hours;

    // 13:30 there: the trend starts at 14:00, and the sun sets at 16:00.
    expect(at('2026-11-17T12:30:00Z')).toEqual([
      { time: '2026-11-17T14:00:00+01:00', temperature: 12, sky: 'partly-cloudy', isDay: true },
      { time: '2026-11-17T16:00:00+01:00', temperature: 12, sky: 'partly-cloudy', isDay: false },
      { time: '2026-11-17T18:00:00+01:00', temperature: 8, sky: 'partly-cloudy', isDay: false }
    ]);
    // 23:30 there: midnight, 2am and 4am.
    expect(at('2026-11-17T22:30:00Z')?.map(hour => hour.time)).toEqual([
      '2026-11-18T00:00:00+01:00',
      '2026-11-18T02:00:00+01:00',
      '2026-11-18T04:00:00+01:00'
    ]);
  });

  it('gives the five days after today, each with its high, low and sky', () => {
    const days = toWeather(answer({ dayCodes: { '2026-11-20': 61 } }), NOW, '24h')?.days;

    expect(days).toEqual([
      { date: '2026-11-18', high: 13, low: 5, sky: 'partly-cloudy' },
      { date: '2026-11-19', high: 14, low: 5, sky: 'partly-cloudy' },
      { date: '2026-11-20', high: 15, low: 5, sky: 'rain' },
      { date: '2026-11-21', high: 16, low: 5, sky: 'partly-cloudy' },
      { date: '2026-11-22', high: 17, low: 5, sky: 'partly-cloudy' }
    ]);
  });

  it("draws Now's sky by day or night from sunrise and sunset", () => {
    const morning = toWeather(answer(), NOW, '24h')?.views;
    const evening = toWeather(answer(), new Date('2026-11-17T19:00:00Z'), '24h')?.views;

    expect(morning?.[0]?.isDay).toBe(true);
    expect(evening?.[0]?.isDay).toBe(false);
  });

  it('is null without a forecast, or with one missing what it reads', () => {
    const broken = answer();
    Object.assign(broken.forecast?.forecast as unknown as { hourly: object }, { hourly: {} });

    expect(toWeather({ ...answer(), forecast: null }, NOW, '24h')).toBeNull();
    expect(toWeather(null, NOW, '24h')).toBeNull();
    expect(toWeather(broken, NOW, '24h')).toBeNull();
  });
});

describe('skyFor and conditionFor', () => {
  it('draws each WMO code', () => {
    expect([0, 1, 2, 3, 45, 53, 61, 73, 81, 86, 96].map(code => skyFor(code))).toEqual([
      'clear',
      'clear',
      'partly-cloudy',
      'cloudy',
      'fog',
      'drizzle',
      'rain',
      'snow',
      'rain',
      'snow',
      'thunder'
    ]);
    expect([0, 1, 48, 55, 63, 65, 75, 85, 99].map(code => conditionFor(code))).toEqual([
      'Clear',
      'Mostly clear',
      'Fog',
      'Drizzle',
      'Rain',
      'Heavy rain',
      'Snow',
      'Snow showers',
      'Thunderstorms'
    ]);
  });
});
