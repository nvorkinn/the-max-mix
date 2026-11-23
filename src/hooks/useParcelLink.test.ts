import { act, renderHook, waitFor } from '@testing-library/react';
import type { DeviceAccount } from 'countdown-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as account from '../countdown/account';
import * as config from '../countdown/config';
import { PARCEL_LINK_POLL_MS, useParcelLink } from './useParcelLink';

const LINKED: DeviceAccount = { parcel: { linked: true }, spotify: { linked: false }, soloist: { linked: false } };
const UNLINKED: DeviceAccount = { parcel: { linked: false }, spotify: { linked: false }, soloist: { linked: false } };

function registered() {
  vi.spyOn(config, 'serverClient').mockReturnValue({ baseUrl: 'https://countdown.build', secret: 'a-device-secret' });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useParcelLink', () => {
  it('cannot tell, and asks nothing, with no server to ask', () => {
    const fetchAccount = vi.spyOn(account, 'fetchDeviceAccount');
    const { result } = renderHook(() => useParcelLink());
    expect(result.current).toBeNull();
    expect(fetchAccount).not.toHaveBeenCalled();
  });

  it('has no answer until the server gives one, and asks once of an account with a key', async () => {
    registered();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchAccount = vi.spyOn(account, 'fetchDeviceAccount').mockResolvedValue(LINKED);
    const onLinked = vi.fn();
    const { result } = renderHook(() => useParcelLink(onLinked));
    expect(result.current).toBeUndefined();
    await waitFor(() => {
      expect(result.current).toBe(true);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PARCEL_LINK_POLL_MS * 3);
    });
    expect(fetchAccount).toHaveBeenCalledOnce();
    // The key was there all along, so the config already has it.
    expect(onLinked).not.toHaveBeenCalled();
  });

  it('cannot tell when the server gives no answer, and leaves it there', async () => {
    registered();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchAccount = vi.spyOn(account, 'fetchDeviceAccount').mockResolvedValue(null);
    const { result } = renderHook(() => useParcelLink());
    await waitFor(() => {
      expect(result.current).toBeNull();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PARCEL_LINK_POLL_MS * 3);
    });
    expect(fetchAccount).toHaveBeenCalledOnce();
  });

  it('keeps asking while the account has no key, through a missed answer, until one is saved', async () => {
    registered();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchAccount = vi.spyOn(account, 'fetchDeviceAccount').mockResolvedValue(UNLINKED);
    const onLinked = vi.fn();
    const { result } = renderHook(() => useParcelLink(onLinked));
    await waitFor(() => {
      expect(result.current).toBe(false);
    });

    fetchAccount.mockResolvedValue(null);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PARCEL_LINK_POLL_MS);
    });
    expect(fetchAccount).toHaveBeenCalledTimes(2);
    expect(result.current).toBe(false);

    fetchAccount.mockResolvedValue(LINKED);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PARCEL_LINK_POLL_MS);
    });
    expect(result.current).toBe(true);
    expect(onLinked).toHaveBeenCalledOnce();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PARCEL_LINK_POLL_MS * 3);
    });
    expect(fetchAccount).toHaveBeenCalledTimes(3);
  });

  it('stops asking once the page is gone', async () => {
    registered();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchAccount = vi.spyOn(account, 'fetchDeviceAccount').mockResolvedValue(UNLINKED);
    const { result, unmount } = renderHook(() => useParcelLink());
    await waitFor(() => {
      expect(result.current).toBe(false);
    });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PARCEL_LINK_POLL_MS * 3);
    });
    expect(fetchAccount).toHaveBeenCalledOnce();
  });
});
