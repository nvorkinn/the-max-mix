import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceWeather } from 'countdown-api';
import panels from '../../vendor/countdown-api/src/countdown_api/fixtures/device_panels.json';
import { conditionsFor, getWeather, toWeather } from './weather';

const server = vi.hoisted(() => ({
  serverClient: vi.fn<() => { baseUrl: string; secret: string } | null>()
}));
vi.mock('../countdown/config', () => ({ serverClient: server.serverClient }));

// countdown-api's example: what getWeather answers a London touchscreen.
// countdown-api types Open-Meteo's own fields as open (Record<string, never>), so the example goes through unknown.
const ANSWER = panels.weather as unknown as DeviceWeather;
// Its forecast's current time, in London in January (UTC).
const NOW = new Date('2026-01-15T12:15:00Z');

const fetchMock = vi.fn<(request: Request) => Promise<Response>>();

describe('weather', () => {
  beforeEach(() => {
    server.serverClient.mockReturnValue({ baseUrl: 'https://api.countdown.build', secret: 'device-secret' });
    fetchMock.mockImplementation(() => Promise.resolve(Response.json(ANSWER)));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    fetchMock.mockReset();
    server.serverClient.mockReset();
    vi.unstubAllGlobals();
  });

  it('turns WMO codes into conditions', () => {
    const codes = [0, 1, 2, 3, 45, 53, 63, 66, 75, 81, 86, 95];
    expect(codes.map(code => conditionsFor(code))).toEqual([
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

  it("reads countdown-server's weather with the device secret: now, and the hours to come by day and night", async () => {
    const weather = await getWeather(NOW);
    const request = fetchMock.mock.calls[0]?.[0];
    expect(String(request instanceof Request ? request.url : request)).toBe(
      'https://api.countdown.build/api/devices/weather'
    );
    expect(weather).toMatchObject({
      updatedAt: '2026-10-17T12:00:00Z',
      location: 'London',
      temperature: 14,
      conditions: 'partly-cloudy',
      daylight: true,
      background: null
    });
    expect(weather?.hours.slice(0, 6)).toEqual([
      { time: '2026-01-15T13:00:00.000Z', temperature: 14, conditions: 'clear', daylight: true },
      { time: '2026-01-15T14:00:00.000Z', temperature: 14, conditions: 'clear', daylight: true },
      { time: '2026-01-15T15:00:00.000Z', temperature: 14, conditions: 'cloudy', daylight: true },
      { time: '2026-01-15T16:00:00.000Z', temperature: 14, conditions: 'clear', daylight: true },
      { time: '2026-01-15T17:00:00.000Z', temperature: 14, conditions: 'clear', daylight: false },
      { time: '2026-01-15T18:00:00.000Z', temperature: 9, conditions: 'clear', daylight: false }
    ]);
  });

  it("reads the place's local times with its offset from UTC", () => {
    const stored = ANSWER.forecast;
    if (!stored) throw new Error('the example has a forecast');
    const oslo: DeviceWeather = {
      ...ANSWER,
      forecast: { ...stored, forecast: { ...stored.forecast, utc_offset_seconds: 3600 } }
    };
    // 13:00 in Oslo is 12:00 UTC.
    expect(toWeather(oslo, NOW)?.hours[0]?.time).toBe('2026-01-15T13:00:00.000Z');
    expect(toWeather(oslo, new Date('2026-01-15T11:30:00Z'))?.hours[0]?.time).toBe('2026-01-15T12:00:00.000Z');
  });

  it('has none for a kiosk that is not registered, with no place or forecast, or when the server fails', async () => {
    server.serverClient.mockReturnValueOnce(null);
    expect(await getWeather(NOW)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(Response.json({ location: '', key: null, forecast: null }));
    expect(await getWeather(NOW)).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    expect(await getWeather(NOW)).toBeNull();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await getWeather(NOW)).toBeNull();
  });

  it('has none for a forecast without the fields it reads', async () => {
    const stored = ANSWER.forecast;
    if (!stored) throw new Error('the example has a forecast');
    const broken = { ...ANSWER, forecast: { ...stored, forecast: { ...stored.forecast, hourly: {} } } };
    fetchMock.mockResolvedValueOnce(Response.json(broken));
    expect(await getWeather(NOW)).toBeNull();
  });
});
