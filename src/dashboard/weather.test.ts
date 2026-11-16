import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceWeather } from './weather';
import { conditionsFor, getWeather } from './weather';

const server = vi.hoisted(() => ({
  serverClient: vi.fn<() => { baseUrl: string; secret: string } | null>()
}));
vi.mock('../countdown/config', () => ({ serverClient: server.serverClient }));

const NOW = new Date('2026-11-16T09:20:00Z');
const hour = (offset: number) => new Date(Date.parse('2026-11-16T09:00:00Z') + offset * 3_600_000).toISOString();

// What countdown-server is to answer at GET /api/devices/weather.
const ANSWER: DeviceWeather = {
  location: 'Oslo',
  key: 'oslo-no-3143244',
  updated_at: '2026-11-16T09:15:00Z',
  current: { temperature: 8.6, weather_code: 2, is_day: true },
  hours: [
    { time: hour(0), temperature: 8.4, weather_code: 2, is_day: true },
    { time: hour(1), temperature: 9.2, weather_code: 3, is_day: true },
    { time: hour(2), temperature: 10.5, weather_code: 61, is_day: true },
    { time: hour(3), temperature: 10.4, weather_code: 80, is_day: true },
    { time: hour(4), temperature: 9.6, weather_code: 45, is_day: true },
    { time: hour(5), temperature: 8.1, weather_code: 0, is_day: false }
  ],
  background: {
    date: '2026-11-16',
    generated_at: '2026-11-16T04:00:00Z',
    fallback: false,
    images: [
      { phase: 'dawn', from: '2026-11-16T07:00:00Z', url: 'https://app.countdown.build/backgrounds/dawn.jpg' },
      { phase: 'day', from: '2026-11-16T08:30:00Z', url: 'https://app.countdown.build/backgrounds/day.jpg' },
      { phase: 'dusk', from: '2026-11-16T14:30:00Z', url: 'https://app.countdown.build/backgrounds/dusk.jpg' },
      { phase: 'night', from: '2026-11-16T16:00:00Z', url: 'https://app.countdown.build/backgrounds/night.jpg' }
    ]
  }
};

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();

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

  it('asks countdown-server with the device secret, and keeps only the hours to come', async () => {
    const weather = await getWeather(NOW);
    expect(fetchMock).toHaveBeenCalledWith('https://api.countdown.build/api/devices/weather', {
      headers: { Authorization: 'Bearer device-secret' }
    });
    expect(weather).toEqual({
      updatedAt: '2026-11-16T09:15:00Z',
      location: 'Oslo',
      temperature: 9,
      conditions: 'partly-cloudy',
      daylight: true,
      hours: [
        { time: hour(1), temperature: 9, conditions: 'cloudy', daylight: true },
        { time: hour(2), temperature: 11, conditions: 'rain', daylight: true },
        { time: hour(3), temperature: 10, conditions: 'rain', daylight: true },
        { time: hour(4), temperature: 10, conditions: 'fog', daylight: true },
        { time: hour(5), temperature: 8, conditions: 'clear', daylight: false }
      ],
      background: 'https://app.countdown.build/backgrounds/day.jpg'
    });
  });

  it("shows the picture for the part of the day it is, and none before the day's first", async () => {
    const at = async (time: string) => {
      const weather = await getWeather(new Date(time));
      return weather?.background;
    };
    expect(await at('2026-11-16T06:59:00Z')).toBeNull();
    expect(await at('2026-11-16T07:00:00Z')).toBe('https://app.countdown.build/backgrounds/dawn.jpg');
    expect(await at('2026-11-16T15:00:00Z')).toBe('https://app.countdown.build/backgrounds/dusk.jpg');
    expect(await at('2026-11-16T23:00:00Z')).toBe('https://app.countdown.build/backgrounds/night.jpg');
    fetchMock.mockImplementationOnce(() => Promise.resolve(Response.json({ ...ANSWER, background: null })));
    expect(await at('2026-11-16T09:20:00Z')).toBeNull();
  });

  it('has none for a kiosk that is not registered', async () => {
    server.serverClient.mockReturnValue(null);
    expect(await getWeather(NOW)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('has none with no place set, or when the server fails or cannot be reached', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await getWeather(NOW)).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    expect(await getWeather(NOW)).toBeNull();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await getWeather(NOW)).toBeNull();
  });
});
