import { describe, expect, it } from 'vitest';
import { getDashboardData, isFresh } from './data';

describe('dashboard data', () => {
  const now = new Date('2026-11-15T09:00:00Z');

  it('counts a section as fresh up to its maximum age, and never one with a bad time', () => {
    expect(isFresh('2026-11-15T08:55:00Z', 5 * 60_000, now)).toBe(true);
    expect(isFresh('2026-11-15T08:54:59Z', 5 * 60_000, now)).toBe(false);
    expect(isFresh('not a time', 5 * 60_000, now)).toBe(false);
  });

  it('gives fresh departures and weather', async () => {
    const data = await getDashboardData(now);
    expect(data.arrivals?.stops.length).toBeGreaterThan(0);
    expect(data.weather?.hours.length).toBeGreaterThan(0);
    expect(data.notices.length).toBeGreaterThan(0);
    expect(isFresh(data.arrivals?.updatedAt ?? '', 60_000, now)).toBe(true);
  });
});
