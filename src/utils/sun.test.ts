import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sunTimes } from './sun';

const LONDON = { lat: 51.5074, lon: -0.1278 };
const TROMSO = { lat: 69.65, lon: 18.96 };
const TWO_MINUTES = 2 * 60_000;

/** Within two minutes of the published time, given as an ISO time with its offset. */
function near(actual: Date | undefined, expected: string) {
  expect(Math.abs((actual?.getTime() ?? Number.NaN) - new Date(expected).getTime())).toBeLessThan(TWO_MINUTES);
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
    near(summer?.sunrise, '2026-06-21T04:43:00+01:00');
    near(summer?.sunset, '2026-06-21T21:21:00+01:00');
    const winter = sunTimes(new Date('2026-12-21T12:00:00Z'), LONDON.lat, LONDON.lon);
    near(winter?.sunrise, '2026-12-21T08:04:00Z');
    near(winter?.sunset, '2026-12-21T15:53:00Z');
  });

  it('follows the clocks going forward', () => {
    const before = sunTimes(new Date('2026-03-28T12:00:00Z'), LONDON.lat, LONDON.lon);
    const after = sunTimes(new Date('2026-03-29T12:00:00+01:00'), LONDON.lat, LONDON.lon);
    near(before?.sunrise, '2026-03-28T05:45:00Z');
    near(after?.sunrise, '2026-03-29T06:43:00+01:00');
    near(after?.sunset, '2026-03-29T19:27:00+01:00');
  });

  it('uses the local calendar day, from just after midnight to just before the next', () => {
    const early = sunTimes(new Date('2026-01-01T00:05:00Z'), LONDON.lat, LONDON.lon);
    const late = sunTimes(new Date('2026-01-01T23:55:00Z'), LONDON.lat, LONDON.lon);
    expect(early).toEqual(late);
    near(early?.sunrise, '2026-01-01T08:06:00Z');
  });

  it('is null under the midnight sun and in the polar night', () => {
    expect(sunTimes(new Date('2026-06-21T12:00:00Z'), TROMSO.lat, TROMSO.lon)).toBeNull();
    expect(sunTimes(new Date('2026-12-21T12:00:00Z'), TROMSO.lat, TROMSO.lon)).toBeNull();
  });

  it('works far from Greenwich and south of the equator', () => {
    process.env['TZ'] = 'America/Los_Angeles';
    const sf = sunTimes(new Date('2026-07-04T12:00:00-07:00'), 37.7749, -122.4194);
    near(sf?.sunrise, '2026-07-04T05:52:00-07:00');
    near(sf?.sunset, '2026-07-04T20:35:00-07:00');
    process.env['TZ'] = 'Australia/Sydney';
    const sydney = sunTimes(new Date('2026-07-04T12:00:00+10:00'), -33.8688, 151.2093);
    near(sydney?.sunrise, '2026-07-04T07:01:00+10:00');
    near(sydney?.sunset, '2026-07-04T16:58:00+10:00');
    process.env['TZ'] = 'Europe/London';
  });
});
