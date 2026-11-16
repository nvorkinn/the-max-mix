import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { conditionsFor, forgetWeather, getWeather, placeId } from './weather';

const NOW = new Date('2026-11-16T09:20:00Z');
const hour = (offset: number) => Date.parse('2026-11-16T09:00:00Z') / 1000 + offset * 3600;

const FORECAST = {
  current: { time: hour(0), temperature_2m: 8.6, weather_code: 2, is_day: 1 },
  hourly: {
    time: [0, 1, 2, 3, 4, 5].map(offset => hour(offset)),
    temperature_2m: [8.4, 9.2, 10.5, 10.4, 9.6, 8.1],
    weather_code: [2, 3, 61, 80, 45, 0],
    is_day: [1, 1, 1, 1, 1, 0]
  }
};

function answer(body: unknown, status = 200) {
  return Promise.resolve(Response.json(body, { status }));
}

const fetchMock = vi.fn<(url: string) => Promise<Response>>();

function openMeteo(url: string) {
  if (url.includes('/v1/get?')) return answer({ id: 3_143_244, name: 'Oslo', latitude: 59.91, longitude: 10.75 });
  if (url.includes('/v1/search?')) return answer({ results: [{ name: 'London', latitude: 51.5, longitude: -0.12 }] });
  return answer(FORECAST);
}

describe('weather', () => {
  beforeEach(() => {
    forgetWeather();
    fetchMock.mockImplementation(openMeteo);
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('reads the Open-Meteo id from a picked place, and none from a typed one', () => {
    expect(placeId('london-gb-2643743')).toBe(2_643_743);
    expect(placeId('atlantis-xx-42')).toBe(42);
    expect(placeId('jp-1850147')).toBe(1_850_147);
    expect(placeId('london')).toBeNull();
    expect(placeId('oslo-0150')).toBeNull();
    expect(placeId('sw1a-1aa')).toBeNull();
    expect(placeId('0150')).toBeNull();
  });

  it('turns WMO codes into conditions', () => {
    expect([0, 1, 2, 3, 45, 53, 63, 66, 75, 81, 86, 95].map(code => conditionsFor(code))).toEqual([
      'clear',
      'clear',
      'partly-cloudy',
      'cloudy',
      'fog',
      'drizzle',
      'rain',
      'rain',
      'snow',
      'rain',
      'snow',
      'thunder'
    ]);
  });

  it('has none without a place', async () => {
    expect(await getWeather(null, NOW)).toBeNull();
    expect(await getWeather({ location: '', key: null }, NOW)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads the weather now and the coming hours for a picked place', async () => {
    const weather = await getWeather({ location: 'Oslo', key: 'oslo-no-3143244' }, NOW);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://geocoding-api.open-meteo.com/v1/get?id=3143244');
    const forecast = new URL(fetchMock.mock.calls[1]?.[0] ?? '');
    expect(forecast.searchParams.get('latitude')).toBe('59.91');
    expect(forecast.searchParams.get('longitude')).toBe('10.75');
    expect(weather).toEqual({
      updatedAt: NOW.toISOString(),
      location: 'Oslo',
      temperature: 9,
      conditions: 'partly-cloudy',
      daylight: true,
      hours: [
        { time: '2026-11-16T10:00:00.000Z', temperature: 9, conditions: 'cloudy', daylight: true },
        { time: '2026-11-16T11:00:00.000Z', temperature: 11, conditions: 'rain', daylight: true },
        { time: '2026-11-16T12:00:00.000Z', temperature: 10, conditions: 'rain', daylight: true },
        { time: '2026-11-16T13:00:00.000Z', temperature: 10, conditions: 'fog', daylight: true },
        { time: '2026-11-16T14:00:00.000Z', temperature: 8, conditions: 'clear', daylight: false }
      ],
      background: null
    });
  });

  it('finds a typed location by name', async () => {
    await getWeather({ location: ' London ', key: 'london' }, NOW);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://geocoding-api.open-meteo.com/v1/search?name=London&count=1');
  });

  it('keeps a reading for ten minutes, and the last one when a new read fails', async () => {
    const place = { location: 'Oslo', key: 'oslo-no-3143244' };
    await getWeather(place, NOW);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await getWeather(place, new Date(NOW.getTime() + 9 * 60_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockImplementation(() => answer({}, 503));
    const later = new Date(NOW.getTime() + 11 * 60_000);
    const kept = await getWeather(place, later);
    expect(kept?.updatedAt).toBe(NOW.toISOString());
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // A failed read is tried again a minute later, not ten.
    await getWeather(place, new Date(later.getTime() + 30_000));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fetchMock.mockImplementation(openMeteo);
    const retried = new Date(later.getTime() + 61_000);
    const fresh = await getWeather(place, retried);
    expect(fresh?.updatedAt).toBe(retried.toISOString());
  });

  it('looks a place up again after a failed lookup', async () => {
    fetchMock.mockImplementationOnce(() => answer({}, 500));
    const place = { location: 'Oslo', key: 'oslo-no-3143244' };
    expect(await getWeather(place, NOW)).toBeNull();
    const aMinuteLater = new Date(NOW.getTime() + 61_000);
    expect(await getWeather(place, aMinuteLater)).not.toBeNull();
    const lookups = fetchMock.mock.calls.filter(([url]) => url.includes('/v1/get?'));
    expect(lookups).toHaveLength(2);
  });
});
