import { useEffect, useEffectEvent } from 'react';
import type { TouchscreenConfig } from 'countdown-api';
import { loadDeviceConfig } from '../countdown/config';

/**
 * Loads the kiosk's config from countdown-server once, at start, and hands it to `onConfig` once someone owns the
 * kiosk. Before that the server answers its pairing value, whose style is only the server's defaults, so the kiosk's
 * own settings stay.
 */
export function useDeviceConfig(onConfig: (config: TouchscreenConfig) => void): void {
  const apply = useEffectEvent(onConfig);
  useEffect(() => {
    let current = true;
    void loadDeviceConfig().then(config => {
      if (current && config?.pairing_code === null) apply(config);
    });
    return () => {
      current = false;
    };
  }, []);
}
