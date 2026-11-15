import { act, renderHook, waitFor } from '@testing-library/react';
import type { TouchscreenConfig } from 'countdown-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json';
import * as config from '../countdown/config';
import { SAVE_DEBOUNCE_MS, useDeviceConfig } from './useDeviceConfig';

const OWNED = fixture.config as TouchscreenConfig;
const PAIRING = fixture.pairing as TouchscreenConfig;
const NIGHT = { ...OWNED.style, skin: 'night' } as const;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function owned() {
  vi.spyOn(config, 'loadDeviceConfig').mockResolvedValue(OWNED);
  const hook = renderHook(() => useDeviceConfig());
  await waitFor(() => {
    expect(hook.result.current.config).toEqual(OWNED);
  });
  vi.useFakeTimers();
  return hook;
}

describe('useDeviceConfig', () => {
  it("loads the config once, and again when asked; an unowned kiosk's is not its owner's", async () => {
    const load = vi.spyOn(config, 'loadDeviceConfig').mockResolvedValue(PAIRING);
    const { result, rerender } = renderHook(() => useDeviceConfig());
    await waitFor(() => {
      expect(result.current.config).toEqual(PAIRING);
    });
    expect(result.current.owned).toBe(false);
    rerender();
    expect(load).toHaveBeenCalledTimes(1);

    load.mockResolvedValue(OWNED);
    act(() => {
      result.current.reload();
    });
    await waitFor(() => {
      expect(result.current.owned).toBe(true);
    });
  });

  it('shows a change at once and saves only the last of a quick run', async () => {
    const save = vi
      .spyOn(config, 'saveConfigSection')
      .mockImplementation((base, section, value) => Promise.resolve({ saved: { ...base, [section]: value } }));
    const { result } = await owned();

    act(() => {
      result.current.save('style', { ...OWNED.style, skin: 'day' });
      result.current.save('style', NIGHT);
    });
    expect(result.current.config?.style).toEqual(NIGHT);
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(OWNED, 'style', NIGHT);
    expect(result.current.status).toBe('saved');
  });

  it('undoes a change the server refuses', async () => {
    vi.spyOn(config, 'saveConfigSection').mockResolvedValue({ error: 'failed' });
    const { result } = await owned();

    act(() => {
      result.current.save('style', NIGHT);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    });
    expect(result.current.status).toBe('failed');
    expect(result.current.config?.style).toEqual(OWNED.style);
  });

  it('loads the latest config when the server says the copy was out of date', async () => {
    vi.spyOn(config, 'saveConfigSection').mockResolvedValue({ error: 'conflict' });
    const { result } = await owned();
    const latest = { ...OWNED, display: { sleep_minutes: 2 as const } };
    vi.mocked(config.loadDeviceConfig).mockResolvedValue(latest);

    act(() => {
      result.current.save('style', NIGHT);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    });
    expect(result.current.config).toEqual(latest);
  });

  it('changes nothing before someone owns the kiosk', async () => {
    const save = vi.spyOn(config, 'saveConfigSection');
    vi.spyOn(config, 'loadDeviceConfig').mockResolvedValue(PAIRING);
    const { result } = renderHook(() => useDeviceConfig());
    await waitFor(() => {
      expect(result.current.config).toEqual(PAIRING);
    });
    act(() => {
      result.current.save('style', NIGHT);
    });
    expect(result.current.config).toEqual(PAIRING);
    expect(save).not.toHaveBeenCalled();
  });
});
