import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as kiosk from '../lights/kiosk';
import type { Light, LightsStatus } from '../lights/kiosk';
import { useLights } from './useLights';

const KITCHEN: Light = {
  id: 'light.kitchen',
  name: 'Worktop',
  on: true,
  brightness: 40,
  dimmable: true,
  available: true
};
const READY: LightsStatus = { state: 'ready', lights: [KITCHEN] };

let send: (status: LightsStatus) => void;
const stopWatching = vi.fn();

beforeEach(() => {
  vi.spyOn(kiosk, 'configureLights').mockResolvedValue(READY);
  vi.spyOn(kiosk, 'watchLights').mockImplementation(onStatus => {
    send = onStatus;
    return stopWatching;
  });
  vi.spyOn(kiosk, 'setLight').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  stopWatching.mockClear();
});

describe('useLights', () => {
  it('has no lights off the kiosk, and asks nothing', () => {
    const { result } = renderHook(() => useLights(false, null));
    expect(result.current.status).toBeNull();
    expect(kiosk.configureLights).not.toHaveBeenCalled();
  });

  it('follows the lights while the config has any', async () => {
    const { result, unmount } = renderHook(() => useLights(true, null));
    await waitFor(() => {
      expect(result.current.status).toEqual(READY);
    });
    act(() => {
      send({ state: 'ready', lights: [{ ...KITCHEN, on: false, brightness: null }] });
    });
    expect(result.current.status?.lights[0]?.on).toBe(false);
    unmount();
    expect(stopWatching).toHaveBeenCalledTimes(1);
  });

  it('does not follow lights the config does not have, and asks again when the config changes', async () => {
    vi.mocked(kiosk.configureLights).mockResolvedValue({ state: 'off', lights: [] });
    const { result, rerender } = renderHook(({ config }) => useLights(true, config), { initialProps: { config: 1 } });
    await waitFor(() => {
      expect(result.current.status?.state).toBe('off');
    });
    expect(kiosk.watchLights).not.toHaveBeenCalled();
    vi.mocked(kiosk.configureLights).mockResolvedValue(READY);
    rerender({ config: 2 });
    await waitFor(() => {
      expect(kiosk.watchLights).toHaveBeenCalledTimes(1);
    });
  });

  it('switches a light at once, and shows it switched until the service has caught up', async () => {
    const { result } = renderHook(() => useLights(true, null));
    await waitFor(() => {
      expect(result.current.status).toEqual(READY);
    });
    vi.useFakeTimers();
    act(() => {
      result.current.change(KITCHEN, { on: false });
    });
    expect(kiosk.setLight).toHaveBeenCalledWith('light.kitchen', false, undefined);
    expect(result.current.status?.lights[0]).toMatchObject({ on: false, brightness: null });
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(result.current.status?.lights[0]).toMatchObject({ on: true, brightness: 40 });
  });

  it('goes to the login page the service gives, and stays when it gives none', async () => {
    const assign = vi.spyOn(kiosk, 'leaveFor').mockImplementation(() => {});
    const start = vi.spyOn(kiosk, 'startLightsSignIn').mockResolvedValue(null);
    const { result } = renderHook(() => useLights(true, null));
    result.current.signIn();
    await waitFor(() => {
      expect(start).toHaveBeenCalledTimes(1);
    });
    expect(assign).not.toHaveBeenCalled();
    start.mockResolvedValue('https://home.example/auth/authorize?state=s1');
    result.current.signIn();
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('https://home.example/auth/authorize?state=s1');
    });
  });

  it('sends a dragged brightness once it rests, and turns the light off at nothing', async () => {
    const { result } = renderHook(() => useLights(true, null));
    await waitFor(() => {
      expect(result.current.status).toEqual(READY);
    });
    vi.useFakeTimers();
    act(() => {
      result.current.change(KITCHEN, { brightness: 55 });
      result.current.change(KITCHEN, { brightness: 70 });
    });
    expect(kiosk.setLight).not.toHaveBeenCalled();
    expect(result.current.status?.lights[0]?.brightness).toBe(70);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(kiosk.setLight).toHaveBeenCalledExactlyOnceWith('light.kitchen', true, 70);
    act(() => {
      result.current.change(KITCHEN, { brightness: 0 });
      vi.advanceTimersByTime(150);
    });
    expect(kiosk.setLight).toHaveBeenLastCalledWith('light.kitchen', false, undefined);
  });
});
