import { renderHook, waitFor } from '@testing-library/react';
import type { TouchscreenConfig } from 'countdown-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json';
import * as config from '../countdown/config';
import { useDeviceConfig } from './useDeviceConfig';

const OWNED = fixture.config as TouchscreenConfig;
const PAIRING = fixture.pairing as TouchscreenConfig;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useDeviceConfig', () => {
  it("hands over an owned kiosk's config once", async () => {
    const load = vi.spyOn(config, 'loadDeviceConfig').mockResolvedValue(OWNED);
    const onConfig = vi.fn();
    const { rerender } = renderHook(() => {
      useDeviceConfig(onConfig);
    });
    await waitFor(() => {
      expect(onConfig).toHaveBeenCalledWith(OWNED);
    });
    rerender();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps the pairing value and an unmounted kiosk to themselves', async () => {
    const load = vi.spyOn(config, 'loadDeviceConfig').mockResolvedValue(PAIRING);
    const onConfig = vi.fn();
    renderHook(() => {
      useDeviceConfig(onConfig);
    });
    await waitFor(() => {
      expect(load).toHaveBeenCalled();
    });

    load.mockResolvedValue(OWNED);
    const { unmount } = renderHook(() => {
      useDeviceConfig(onConfig);
    });
    unmount();
    await Promise.resolve();
    expect(onConfig).not.toHaveBeenCalled();
  });
});
