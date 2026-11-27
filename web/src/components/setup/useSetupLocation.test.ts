import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceLocation } from 'countdown-api';
import locate from '../../../../vendor/countdown-api/src/countdown_api/fixtures/locate.json';
import { keepSetupLocation, keptSetupLocation, locateKiosk } from '../../countdown/location';
import { nearbyStops, SearchFailed } from '../../countdown/search';
import type { NearbyStop } from '../../countdown/search';
import { LOCATE_RETRY_MS, useSetupLocation } from './useSetupLocation';

vi.mock('../../countdown/location', async importOriginal => ({
  ...(await importOriginal<typeof import('../../countdown/location')>()),
  locateKiosk: vi.fn()
}));
vi.mock('../../countdown/search', async importOriginal => ({
  ...(await importOriginal<typeof import('../../countdown/search')>()),
  nearbyStops: vi.fn()
}));

const LOCATION = locate.locate as DeviceLocation;
const STOPS: NearbyStop[] = [
  {
    key: 'tfl:490014501K',
    name: 'Westmoreland Road',
    detail: '40, 68',
    letter: 'K',
    indent: false,
    value: { source: 'tfl', id: '490014501K' },
    distance: 136
  }
];

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(locateKiosk).mockResolvedValue(LOCATION);
  vi.mocked(nearbyStops).mockResolvedValue(STOPS);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useSetupLocation', () => {
  it('waits until it is let run', () => {
    const { result } = renderHook(() => useSetupLocation(false));
    expect(result.current).toBeUndefined();
    expect(locateKiosk).not.toHaveBeenCalled();
  });

  it('finds where the kiosk is, then the stops near the position found, and keeps both', async () => {
    const { result } = renderHook(() => useSetupLocation(true));
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toEqual({ location: LOCATION, stops: STOPS }));
    // At Google's position, not a postcode's.
    expect(nearbyStops).toHaveBeenCalledExactlyOnceWith(LOCATION, expect.any(AbortSignal));
    expect(keptSetupLocation()).toEqual({ location: LOCATION, stops: STOPS });
  });

  it('uses what it found before the page reloaded, without scanning again', () => {
    keepSetupLocation({ location: LOCATION, stops: STOPS });
    const { result } = renderHook(() => useSetupLocation(true));
    expect(result.current).toEqual({ location: LOCATION, stops: STOPS });
    expect(locateKiosk).not.toHaveBeenCalled();
    expect(nearbyStops).not.toHaveBeenCalled();
  });

  it('scans again once what it found is over an hour old', async () => {
    keepSetupLocation({ location: LOCATION, stops: STOPS }, Date.now() - 61 * 60 * 1000);
    const { result } = renderHook(() => useSetupLocation(true));
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBeDefined());
    expect(locateKiosk).toHaveBeenCalledOnce();
  });

  it('tries once more when the first finds nothing, then gives up', async () => {
    vi.mocked(locateKiosk).mockResolvedValue(null);
    const { result } = renderHook(() => useSetupLocation(true));
    await waitFor(() => expect(locateKiosk).toHaveBeenCalledOnce());
    expect(result.current).toBeUndefined();
    await act(() => vi.advanceTimersByTimeAsync(LOCATE_RETRY_MS));
    await waitFor(() => expect(result.current).toBeNull());
    expect(locateKiosk).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(LOCATE_RETRY_MS * 4));
    expect(locateKiosk).toHaveBeenCalledTimes(2);
    expect(nearbyStops).not.toHaveBeenCalled();
    expect(keptSetupLocation()).toBeNull();
  });

  it('finds it the second time', async () => {
    vi.mocked(locateKiosk).mockResolvedValueOnce(null);
    const { result } = renderHook(() => useSetupLocation(true));
    await waitFor(() => expect(locateKiosk).toHaveBeenCalledOnce());
    await act(() => vi.advanceTimersByTimeAsync(LOCATE_RETRY_MS));
    await waitFor(() => expect(result.current).toEqual({ location: LOCATION, stops: STOPS }));
  });

  it('keeps the location without stops when they could not be had, for the chapter to ask for them', async () => {
    vi.mocked(nearbyStops).mockRejectedValue(new SearchFailed());
    const { result } = renderHook(() => useSetupLocation(true));
    await waitFor(() => expect(result.current).toEqual({ location: LOCATION, stops: null }));
    expect(keptSetupLocation()).toEqual({ location: LOCATION, stops: null });
  });

  it('stops looking when it is no longer let run', async () => {
    // The scan takes a few seconds.
    vi.mocked(locateKiosk).mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve(LOCATION), LOCATE_RETRY_MS))
    );
    const { result, rerender } = renderHook(({ isRunning }) => useSetupLocation(isRunning), {
      initialProps: { isRunning: true }
    });
    const [signal] = vi.mocked(locateKiosk).mock.calls[0] ?? [];
    rerender({ isRunning: false });
    expect(signal?.aborted).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(LOCATE_RETRY_MS));
    expect(result.current).toBeUndefined();
    expect(nearbyStops).not.toHaveBeenCalled();
  });
});
