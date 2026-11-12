import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sunTimes } from './sun';

const LONDON = { lat: 51.5074, lon: -0.1278 };
// Northern Norway, well inside the Arctic Circle.
const ARCTIC = { lat: 69.65, lon: 18.96 };
const TWO_MINUTES = 2 * 60_000;

/** How far `actual` is from the published time, given as an ISO time with its offset. */
function off(actual: Date | undefined, expected: string): number {
  return Math.abs((actual?.getTime() ?? NaN) - new Date(expected).getTime());
}

describe('sunTimes', () => {
  // The kiosk's own time zone, which decides which calendar day a time belongs to (Node reads TZ when it changes).
  const zone = process.env['TZ'];
  beforeAll(() => {
    process.env['TZ'] = 'Europe/London';
  });
  afterAll(() => {
    if (zone === undefined) delete process.env['TZ'];
    else process.env['TZ'] = zone;
  });

  it('matches published London times in summer and winter', () => {
    const summer = sunTimes(new Date('2026-06-21T12:00:00+01:00'), LONDON.lat, LONDON.lon);
    expect(off(summer?.sunrise, '2026-06-21T04:43:00+01:00')).toBeLessThan(TWO_MINUTES);
    expect(off(summer?.sunset, '2026-06-21T21:21:00+01:00')).toBeLessThan(TWO_MINUTES);
    const winter = sunTimes(new Date('2026-12-21T12:00:00Z'), LONDON.lat, LONDON.lon);
    expect(off(winter?.sunrise, '2026-12-21T08:04:00Z')).toBeLessThan(TWO_MINUTES);
    expect(off(winter?.sunset, '2026-12-21T15:53:00Z')).toBeLessThan(TWO_MINUTES);
  });

  it('follows the clocks going forward', () => {
    const before = sunTimes(new Date('2026-03-28T12:00:00Z'), LONDON.lat, LONDON.lon);
    const after = sunTimes(new Date('2026-03-29T12:00:00+01:00'), LONDON.lat, LONDON.lon);
    expect(off(before?.sunrise, '2026-03-28T05:45:00Z')).toBeLessThan(TWO_MINUTES);
    expect(off(after?.sunrise, '2026-03-29T06:43:00+01:00')).toBeLessThan(TWO_MINUTES);
    expect(off(after?.sunset, '2026-03-29T19:27:00+01:00')).toBeLessThan(TWO_MINUTES);
  });

  it('uses the local calendar day, from just after midnight to just before the next', () => {
    const early = sunTimes(new Date('2026-01-01T00:05:00Z'), LONDON.lat, LONDON.lon);
    const late = sunTimes(new Date('2026-01-01T23:55:00Z'), LONDON.lat, LONDON.lon);
    expect(early).toEqual(late);
    expect(off(early?.sunrise, '2026-01-01T08:06:00Z')).toBeLessThan(TWO_MINUTES);
  });

  it('is null under the midnight sun and in the polar night', () => {
    expect(sunTimes(new Date('2026-06-21T12:00:00Z'), ARCTIC.lat, ARCTIC.lon)).toBeNull();
    expect(sunTimes(new Date('2026-12-21T12:00:00Z'), ARCTIC.lat, ARCTIC.lon)).toBeNull();
  });

  it('works far from Greenwich and south of the equator', () => {
    process.env['TZ'] = 'America/Los_Angeles';
    const sf = sunTimes(new Date('2026-07-04T12:00:00-07:00'), 37.7749, -122.4194);
    expect(off(sf?.sunrise, '2026-07-04T05:52:00-07:00')).toBeLessThan(TWO_MINUTES);
    expect(off(sf?.sunset, '2026-07-04T20:35:00-07:00')).toBeLessThan(TWO_MINUTES);
    process.env['TZ'] = 'Australia/Sydney';
    const sydney = sunTimes(new Date('2026-07-04T12:00:00+10:00'), -33.8688, 151.2093);
    expect(off(sydney?.sunrise, '2026-07-04T07:01:00+10:00')).toBeLessThan(TWO_MINUTES);
    expect(off(sydney?.sunset, '2026-07-04T16:58:00+10:00')).toBeLessThan(TWO_MINUTES);
    process.env['TZ'] = 'Europe/London';
  });
});
