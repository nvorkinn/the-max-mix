import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DeviceArrivals, DeviceWeather } from 'countdown-api';
import panels from '../../vendor/countdown-api/src/countdown_api/fixtures/device_panels.json';
import type { Client } from '../../vendor/countdown-api/src/countdown_api/client';
import type { FeedHandlers } from './feed';
import { LiveDashboard } from './live';
import { useLiveDashboard } from './useLiveDashboard';

const NOW = new Date('2026-10-17T12:00:30Z');

describe('useLiveDashboard', () => {
  it('reads the feed while mounted and gives the props as of the given time', () => {
    let feed: FeedHandlers | undefined;
    const close = vi.fn();
    const source = new LiveDashboard(
      () => ({ baseUrl: 'https://api.countdown.build', secret: 'device-secret' }) satisfies Client,
      (_client, handlers) => {
        feed = handlers;
        return close;
      }
    );
    const buses = () => result.current.boards.find(({ kind }) => kind === 'bus')?.departures;
    const { result, rerender, unmount } = renderHook(({ now }) => useLiveDashboard(now, '24h', source), {
      initialProps: { now: NOW }
    });
    expect(result.current.boards).toEqual([]);

    act(() => {
      feed?.onEvent({ event: 'arrivals', data: panels.arrivals as DeviceArrivals });
    });
    expect(buses()).toHaveLength(2);

    // A minute on, the first bus (due 12:01) is still there to show as due; three minutes on it has gone.
    rerender({ now: new Date(NOW.getTime() + 3 * 60_000) });
    expect(buses()).toHaveLength(1);

    unmount();
    expect(close).toHaveBeenCalled();
  });

  it("keeps yesterday's last photo until the new day's first is due", () => {
    vi.stubEnv('VITE_COUNTDOWN_API', 'https://api.countdown.build');
    let feed: FeedHandlers | undefined;
    const source = new LiveDashboard(
      () => ({ baseUrl: 'https://api.countdown.build', secret: 'device-secret' }) satisfies Client,
      (_client, handlers) => {
        feed = handlers;
        return () => {};
      }
    );
    const weather = panels.weather as unknown as DeviceWeather;
    const evening = new Date('2026-01-15T23:00:00Z');
    const { result, rerender } = renderHook(({ now }) => useLiveDashboard(now, '24h', source), {
      initialProps: { now: evening }
    });
    act(() => {
      feed?.onEvent({ event: 'weather', data: weather });
    });
    const night = result.current.backdrop;
    expect(night).toMatch(/\/api\/backgrounds\//);

    // After midnight the server has the new day's photos, none due yet.
    const tomorrow = {
      ...weather,
      background: weather.background && {
        ...weather.background,
        local_date: '2026-01-16',
        images: weather.background.images.map(image => ({ ...image, starts_at: '2026-01-16T07:31:00+00:00' }))
      }
    };
    act(() => {
      feed?.onEvent({ event: 'weather', data: tomorrow });
    });
    rerender({ now: new Date('2026-01-16T01:00:00Z') });
    expect(result.current.backdrop).toBe(night);
    vi.unstubAllEnvs();
  });
});
