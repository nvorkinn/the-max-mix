import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_QUIET_HOURS, loadQuietHours, isQuietTime, saveQuietHours, stepTime } from './quietHours';

const at = (time: string) => new Date(`2026-01-01T${time}:00`);

describe('quiet hours', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('are off by default, 22:00 to 07:00 once turned on', () => {
    expect(loadQuietHours()).toEqual({ on: false, start: 22 * 60, end: 7 * 60 });
  });

  it('remember what was set', () => {
    saveQuietHours({ on: true, start: 23 * 60 + 30, end: 6 * 60 });
    expect(loadQuietHours()).toEqual({ on: true, start: 23 * 60 + 30, end: 6 * 60 });
  });

  it('ignore a stored value that is not quiet hours', () => {
    localStorage.setItem('maxmix.quietHours', '{"on":true,"start":1500,"end":60}');
    expect(loadQuietHours()).toEqual(DEFAULT_QUIET_HOURS);
    localStorage.setItem('maxmix.quietHours', 'soon');
    expect(loadQuietHours()).toEqual(DEFAULT_QUIET_HOURS);
  });

  it('fall back to the default when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadQuietHours()).toEqual(DEFAULT_QUIET_HOURS);
  });

  it('run past midnight when they end before they start', () => {
    const hours = { on: true, start: 22 * 60, end: 7 * 60 };
    expect(isQuietTime(hours, at('21:59'))).toBe(false);
    expect(isQuietTime(hours, at('22:00'))).toBe(true);
    expect(isQuietTime(hours, at('03:00'))).toBe(true);
    expect(isQuietTime(hours, at('06:59'))).toBe(true);
    expect(isQuietTime(hours, at('07:00'))).toBe(false);
  });

  it('can sit within one day', () => {
    const hours = { on: true, start: 13 * 60, end: 14 * 60 + 30 };
    expect(isQuietTime(hours, at('12:59'))).toBe(false);
    expect(isQuietTime(hours, at('14:00'))).toBe(true);
    expect(isQuietTime(hours, at('14:30'))).toBe(false);
  });

  it('are never quiet when off or when both times are the same', () => {
    expect(isQuietTime({ on: false, start: 22 * 60, end: 7 * 60 }, at('23:00'))).toBe(false);
    expect(isQuietTime({ on: true, start: 60, end: 60 }, at('01:00'))).toBe(false);
  });

  it('step half an hour at a time, round the clock', () => {
    expect(stepTime(22 * 60, 1)).toBe(22 * 60 + 30);
    expect(stepTime(23 * 60 + 30, 1)).toBe(0);
    expect(stepTime(0, -1)).toBe(23 * 60 + 30);
  });
});
