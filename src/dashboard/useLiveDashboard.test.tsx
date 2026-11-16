import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DeviceArrivals } from 'countdown-api';
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
    const { result, rerender, unmount } = renderHook(({ now }) => useLiveDashboard(now, '24h', source), {
      initialProps: { now: NOW }
    });
    expect(result.current.bus).toBeNull();

    act(() => {
      feed?.onEvent({ event: 'arrivals', data: panels.arrivals as DeviceArrivals });
    });
    expect(result.current.bus?.departures).toHaveLength(2);

    // A minute on, the first bus (due 12:01) is still there to show as due; three minutes on it has gone.
    rerender({ now: new Date(NOW.getTime() + 3 * 60_000) });
    expect(result.current.bus?.departures).toHaveLength(1);

    unmount();
    expect(close).toHaveBeenCalled();
  });
});
