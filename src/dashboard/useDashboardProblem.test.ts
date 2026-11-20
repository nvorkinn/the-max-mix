import { describe, expect, it } from 'vitest';
import type { DeviceArrivals } from 'countdown-api';
import { DEPARTURES_STALE_MS, STALE_AFTER_MS } from './dashboardProps';
import { EMPTY_SNAPSHOT } from './live';
import type { LiveSnapshot } from './live';
import { dashboardTrouble } from './useDashboardProblem';

const NOW = Date.parse('2026-11-20T12:00:00Z');

function withDepartures(readAt: number): LiveSnapshot {
  const arrivals = {
    stops: [{ source: 'tfl', id: 'stop', departures: { fetched_at: new Date(readAt).toISOString() } }]
  } as unknown as DeviceArrivals;
  return { ...EMPTY_SNAPSHOT, arrivals };
}

describe('what is wrong with the Dashboard', () => {
  it('is nothing with fresh departures, or none at all', () => {
    expect(dashboardTrouble(EMPTY_SNAPSHOT, NOW)).toBeNull();
    expect(dashboardTrouble(withDepartures(NOW - 30_000), NOW)).toBeNull();
  });

  it('is the feed once it has been down long enough, not for a blip', () => {
    const down = { ...withDepartures(NOW), downSince: NOW - STALE_AFTER_MS + 1000 };
    expect(dashboardTrouble(down, NOW)).toBeNull();
    expect(dashboardTrouble(down, NOW + 1000)).toBe('feed');
  });

  it('is the departures when a stop is held from before or was read too long ago', () => {
    expect(dashboardTrouble({ ...withDepartures(NOW), heldStops: new Set(['stop']) }, NOW)).toBe('departures');
    expect(dashboardTrouble(withDepartures(NOW - DEPARTURES_STALE_MS - 1000), NOW)).toBe('departures');
  });
});
