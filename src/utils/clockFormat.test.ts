import { describe, expect, it } from 'vitest';
import { formatClockTime } from './clockFormat';

describe('formatClockTime', () => {
  const afternoon = new Date(2026, 10, 15, 16, 5);

  it('writes 24-hour times with two-digit hours', () => {
    expect(formatClockTime(afternoon, '24h')).toBe('16:05');
    expect(formatClockTime(new Date(2026, 10, 15, 9, 5), '24h')).toBe('09:05');
  });

  it('writes 12-hour times with AM or PM', () => {
    expect(formatClockTime(afternoon, '12h')).toMatch(/^4:05\s?PM$/i);
  });
});
