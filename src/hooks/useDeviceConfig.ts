import { useEffect, useEffectEvent } from 'react';
import type { TouchscreenConfig } from 'countdown-api';
import { loadDeviceConfig } from '../countdown/config';

/** Loads the kiosk's config from countdown-server once, at start, and hands it to `onConfig` when there is one. */
export function useDeviceConfig(onConfig: (config: TouchscreenConfig) => void): void {
  const apply = useEffectEvent(onConfig);
  useEffect(() => {
    let current = true;
    void loadDeviceConfig().then(config => {
      if (current && config) apply(config);
    });
    return () => {
      current = false;
    };
  }, []);
}
