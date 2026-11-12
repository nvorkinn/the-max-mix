import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { skinAt, useTheme } from './useTheme';

const LONDON = { lat: 51.51, lon: -0.13 };

function visit(search: string) {
  history.replaceState(null, '', `/${search}`);
}

describe('skinAt', () => {
  it('is Day from sunrise to sunset and Night otherwise', () => {
    expect(skinAt(new Date('2026-06-21T12:00:00Z'), LONDON)).toBe('day');
    expect(skinAt(new Date('2026-06-21T21:30:00Z'), LONDON)).toBe('night');
    expect(skinAt(new Date('2026-12-21T07:00:00Z'), LONDON)).toBe('night');
  });

  it('is Day when the sun neither rises nor sets', () => {
    expect(skinAt(new Date('2026-12-21T12:00:00Z'), { lat: 69.65, lon: 18.96 })).toBe('day');
  });
});

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    visit('');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is Day by default and keeps Night across a reload', () => {
    const first = renderHook(() => useTheme());
    expect(first.result.current.skin).toBe('day');
    act(() => {
      first.result.current.change('night');
    });
    expect(first.result.current.skin).toBe('night');
    first.unmount();
    expect(renderHook(() => useTheme()).result.current.skin).toBe('night');
  });

  it('offers Auto only when the kiosk address carries a location', () => {
    expect(renderHook(() => useTheme()).result.current.autoOffered).toBe(false);
    visit('?kiosk=1&lat=51.51&lon=-0.13');
    expect(renderHook(() => useTheme()).result.current.autoOffered).toBe(true);
  });

  it('shows Day for a stored Auto when the location is gone', () => {
    localStorage.setItem('maxmix.theme', 'auto');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('day');
    expect(result.current.skin).toBe('day');
  });

  it('turns to Night at sunset without a reload', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-06-21T20:15:00Z'));
    visit('?kiosk=1&lat=51.51&lon=-0.13');
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.change('auto');
    });
    expect(result.current.skin).toBe('day');
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(result.current.skin).toBe('night');
    expect(localStorage.getItem('maxmix.theme')).toBe('auto');
  });
});
