import { act, renderHook, waitFor } from '@testing-library/react';
import type { DeviceAccount, StoredPodcasts, TouchscreenConfig } from 'countdown-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json';
import podcastsFixture from '../../../vendor/countdown-api/src/countdown_api/fixtures/podcasts.json';
import * as account from '../countdown/account';
import * as config from '../countdown/config';
import * as api from '../podcasts/api';
import { deferred } from '../test/deferred';
import { PODCASTS_POLL_MS, usePodcasts, usePodcastsTab } from './usePodcasts';

const CONFIG = fixture.config as TouchscreenConfig;
const account_ = (nrk: boolean): DeviceAccount => ({
  parcel: { linked: false },
  spotify: { linked: true },
  nrk: { linked: nrk }
});

function registered() {
  vi.spyOn(config, 'serverClient').mockReturnValue({ baseUrl: 'https://countdown.build', secret: 'a-device-secret' });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('usePodcastsTab', () => {
  it('shows the tab while podcasts are on and the owner has NRK linked, asking again every few minutes', async () => {
    registered();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchAccount = vi.spyOn(account, 'fetchDeviceAccount').mockResolvedValue(account_(false));
    const { result } = renderHook(() => usePodcastsTab(CONFIG));
    await waitFor(() => {
      expect(fetchAccount).toHaveBeenCalledOnce();
    });
    expect(result.current).toBe(false);
    fetchAccount.mockResolvedValue(account_(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PODCASTS_POLL_MS);
    });
    expect(result.current).toBe(true);
    // A missed answer keeps the tab.
    fetchAccount.mockResolvedValue(null);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PODCASTS_POLL_MS);
    });
    expect(result.current).toBe(true);
  });

  it('counts podcasts left out of the config as on', async () => {
    registered();
    vi.spyOn(account, 'fetchDeviceAccount').mockResolvedValue(account_(true));
    const { result } = renderHook(() => usePodcastsTab({ ...CONFIG, podcasts: null }));
    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  it('has no tab with podcasts off, no config or no server, and asks nothing then', () => {
    const fetchAccount = vi.spyOn(account, 'fetchDeviceAccount').mockResolvedValue(account_(true));
    expect(renderHook(() => usePodcastsTab(CONFIG)).result.current).toBe(false);
    registered();
    const off = { ...CONFIG, podcasts: { enabled: false } };
    expect(renderHook(() => usePodcastsTab(off)).result.current).toBe(false);
    expect(renderHook(() => usePodcastsTab(null)).result.current).toBe(false);
    expect(fetchAccount).not.toHaveBeenCalled();
  });
});

describe('usePodcasts', () => {
  const PODCASTS = podcastsFixture.value as StoredPodcasts;

  it('has nothing while the server gives nothing, and drops an answer that comes after the tab closed', async () => {
    const second = deferred<StoredPodcasts | null>();
    vi.spyOn(api, 'fetchPodcasts').mockResolvedValueOnce(null).mockReturnValueOnce(second.promise);
    const { result, rerender } = renderHook(({ open }) => usePodcasts(open), { initialProps: { open: true } });
    await waitFor(() => {
      expect(api.fetchPodcasts).toHaveBeenCalledOnce();
    });
    expect(result.current).toBeNull();
    rerender({ open: false });
    rerender({ open: true });
    await waitFor(() => {
      expect(api.fetchPodcasts).toHaveBeenCalledTimes(2);
    });
    rerender({ open: false });
    await act(async () => {
      second.resolve(PODCASTS);
      await Promise.resolve();
    });
    expect(result.current).toBeNull();
  });

  it('reads the shows when the tab opens and every few minutes while it is open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchPodcasts = vi.spyOn(api, 'fetchPodcasts').mockResolvedValue(PODCASTS);
    const { result, rerender } = renderHook(({ open }) => usePodcasts(open), { initialProps: { open: false } });
    expect(result.current).toBeNull();
    expect(fetchPodcasts).not.toHaveBeenCalled();
    rerender({ open: true });
    await waitFor(() => {
      expect(result.current).toEqual(PODCASTS);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PODCASTS_POLL_MS);
    });
    expect(fetchPodcasts).toHaveBeenCalledTimes(2);
    // Closed, it reads no more, and keeps what it had, through a missed answer too.
    fetchPodcasts.mockResolvedValue(null);
    rerender({ open: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PODCASTS_POLL_MS * 3);
    });
    expect(fetchPodcasts).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual(PODCASTS);
  });
});
