import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { NETWORK_ERROR_MESSAGE } from '../spotify/http';
import { useIsOffline, useOnlineStatus } from './useOnlineStatus';

function setOnLine(value: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value);
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

describe('useOnlineStatus', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('is online when the browser is, and follows the online and offline events', () => {
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
    act(() => setOnLine(false));
    expect(result.current).toBe(false);
    act(() => setOnLine(true));
    expect(result.current).toBe(true);
  });

  it('starts offline when the browser already is', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);
  });

  it('stops listening on unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    renderHook(() => useOnlineStatus()).unmount();
    expect(remove).toHaveBeenCalledWith('online', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('offline', expect.any(Function));
  });
});

describe('useIsOffline', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('is false online with no error', () => {
    expect(renderHook(() => useIsOffline(null)).result.current).toBe(false);
  });

  it('is true while the browser is offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(renderHook(() => useIsOffline(null)).result.current).toBe(true);
  });

  it('turns true after network errors persist, and clears when they stop', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ error }: { error: string | null }) => useIsOffline(error), {
      initialProps: { error: NETWORK_ERROR_MESSAGE }
    });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(19_000);
    });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(true);
    rerender({ error: null });
    expect(result.current).toBe(false);
  });

  it('ignores other errors', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useIsOffline('Spotify said no'));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(false);
  });
});
