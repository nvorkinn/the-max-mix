import { describe, expect, it } from 'vitest';
import type { DeviceWeather } from 'countdown-api';
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
  it('rotates Now, Tonight, Tomorrow and the Weekend, each with its own temperature', () => {
    const weather = toWeather(answer(), NOW, '24h');

    expect(weather?.views.map(view => [view.period, view.temperature, view.sky, view.condition])).toEqual([
      ['now', 9, 'partly-cloudy', 'Partly cloudy'],
      ['tonight', 8, 'partly-cloudy', 'Partly cloudy'],
      ['tomorrow', 13, 'partly-cloudy', 'Partly cloudy'],
      // Saturday 16 and Sunday 17: the warmer of the two.
      ['weekend', 17, 'partly-cloudy', 'Partly cloudy']
    ]);
  });

  it("says when rain comes later today only past the hourly strip's hours", () => {
    const rainLater = toWeather(answer({ codes: { '2026-11-17T16': 61, '2026-11-17T17': 61 } }), NOW, '12h');
    const rainSoon = toWeather(answer({ codes: { '2026-11-17T11': 61 } }), NOW, '12h');

    expect(rainLater?.views[0]?.summary).toBe('Rain from 4pm');
    expect(toWeather(answer({ codes: { '2026-11-17T16': 61 } }), NOW, '24h')?.views[0]?.summary).toBe(
      'Rain from 16:00'
    );
    // The strip already shows it.
    expect(rainSoon?.views[0]?.summary).toBeNull();
  });

  it('says when it dries up, when it is still raining at the end of the strip', () => {
    const codes: Record<string, number> = {};
    for (let hour = 9; hour < 19; hour += 1) codes[`2026-11-17T${String(hour).padStart(2, '0')}`] = 63;

    expect(toWeather(answer({ codes }), NOW, '12h')?.views[0]?.summary).toBe('Dry from 7pm');
  });

  it("gives tomorrow's rain hour, or says it stays dry", () => {
    const wet = answer({ codes: { '2026-11-18T14': 80 }, dayCodes: { '2026-11-18': 80 } });

    expect(toWeather(wet, NOW, '12h')?.views[2]).toMatchObject({
      sky: 'rain',
      condition: 'Showers',
      summary: 'Rain from 2pm'
    });
    expect(toWeather(answer(), NOW, '12h')?.views[2]?.summary).toBe('Dry all day');
  });

  it('names the wet day of the weekend, and shows the worse sky', () => {
    const weather = toWeather(answer({ dayCodes: { '2026-11-22': 65 } }), NOW, '24h');

    expect(weather?.views[3]).toMatchObject({ sky: 'rain', condition: 'Heavy rain', summary: 'Rain on Sunday' });
  });

  it("shows tonight's worst wet sky once a quarter of its hours are wet", () => {
    const codes = { '2026-11-17T20': 95, '2026-11-17T21': 61, '2026-11-17T22': 61 };

    expect(toWeather(answer({ codes }), NOW, '24h')?.views[1]).toMatchObject({
      sky: 'thunder',
      condition: 'Thunderstorms'
    });
  });

  it('leaves the weekend out on a Saturday, as Tomorrow says Sunday', () => {
    const saturday = new Date('2026-11-21T10:00:00Z');
    const current = { time: '2026-11-21T10:00', temperature: 10, weather_code: 2 };
    const weather = answer();
    Object.assign(weather.forecast?.forecast as unknown as { current: object }, { current });

    expect(toWeather(weather, saturday, '24h')?.views.map(view => view.period)).toEqual(['now', 'tonight', 'tomorrow']);
  });

  it('gives the hours after now, in the place offset, with day and night from sunrise and sunset', () => {
    const hours = toWeather(answer({ offsetSeconds: 3600 }), new Date('2026-11-17T13:30:00Z'), '24h')?.hours;

    // 14:30 there: the strip starts at 15:00, and the sun sets at 16:00.
    expect(hours?.slice(0, 3)).toEqual([
      { time: '2026-11-17T15:00:00+01:00', temperature: 12, sky: 'partly-cloudy', isDay: true },
      { time: '2026-11-17T16:00:00+01:00', temperature: 12, sky: 'partly-cloudy', isDay: false },
      { time: '2026-11-17T17:00:00+01:00', temperature: 12, sky: 'partly-cloudy', isDay: false }
    ]);
    expect(hours).toHaveLength(8);
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
