import { describe, expect, it } from 'vitest';
import { busesAt, SAMPLE, SAMPLE_NOW } from './sample';

describe('the Dashboard sample data', () => {
  it.each([
    ['Tube', SAMPLE.tube.departures],
    ['Bus', SAMPLE.bus.departures]
  ])('gives every %s departure its own vehicle, soonest first and still to come', (_board, departures) => {
    const vehicles = new Set(departures.map(departure => departure.vehicleId));
    expect(vehicles.size).toBe(departures.length);
    const times = departures.map(departure => Date.parse(departure.expectedAt));
    expect(times).toEqual(times.toSorted((a, b) => a - b));
    expect(times.every(time => time > SAMPLE_NOW.getTime())).toBe(true);
  });

  it('has more departures than the four rows a board shows, so rows can move up', () => {
    expect(SAMPLE.tube.departures.length).toBeGreaterThan(4);
    expect(SAMPLE.bus.departures.length).toBeGreaterThan(4);
  });

  it('starts the weather on Now', () => {
    expect(SAMPLE.weather.views[0]?.period).toBe('now');
  });

  it('gives every notice its own id', () => {
    const ids = new Set(SAMPLE.notices.notices.map(notice => notice.id));
    expect(ids.size).toBe(SAMPLE.notices.notices.length);
  });

  it('has the 35 bus overtake the 148 as the clock runs, the order staying soonest first', () => {
    const routesAt = (minutes: number) =>
      busesAt(new Date(SAMPLE_NOW.getTime() + minutes * 60_000)).map(bus => bus.route);
    expect(routesAt(0)).toEqual(['12', '343', '148', '35', '40', '363']);
    expect(routesAt(3)).toEqual(['12', '343', '35', '148', '40', '363']);
  });
});
