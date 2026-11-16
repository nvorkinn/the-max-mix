import { describe, expect, it, vi } from 'vitest';
import { getDashboardData, isFresh } from './data';

const arrivals = vi.hoisted(() => ({ readArrivals: vi.fn(() => Promise.resolve(null)) }));
vi.mock('./arrivals', () => arrivals);

describe('dashboard data', () => {
  const now = new Date('2026-11-15T09:00:00Z');

  it('counts a section as fresh up to its maximum age, and never one with a bad time', () => {
    expect(isFresh('2026-11-15T08:55:00Z', 5 * 60_000, now)).toBe(true);
    expect(isFresh('2026-11-15T08:54:59Z', 5 * 60_000, now)).toBe(false);
    expect(isFresh('not a time', 5 * 60_000, now)).toBe(false);
  });

  it('asks countdown-server for departures only for an owner with stops', async () => {
    const settings = {
      arrivals: { stops: [{ source: 'tfl' as const, id: '490000077E' }] },
      weather: { location: 'London', key: 'london-gb-2643743' },
      notice_board: { postcode: null, country: null }
    };
    await getDashboardData(null, now);
    await getDashboardData({ ...settings, arrivals: { stops: [] } }, now);
    expect(arrivals.readArrivals).not.toHaveBeenCalled();
    await getDashboardData(settings, now);
    expect(arrivals.readArrivals).toHaveBeenCalledOnce();
  });

  it('gives fresh weather and notices', async () => {
    const data = await getDashboardData(null, now);
    expect(data.weather?.hours.length).toBeGreaterThan(0);
    expect(data.notices.length).toBeGreaterThan(0);
    expect(isFresh(data.weather?.updatedAt ?? '', 60_000, now)).toBe(true);
  });
});
