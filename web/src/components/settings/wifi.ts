import { useCallback, useEffect, useState } from 'react';
import { currentWifi } from '../../utils/kiosk';
import type { Translate } from '../../i18n/translate';

/**
 * The kiosk's Wi-Fi as far as its service says: still asking, on a network, on none, or it could not tell. With an
 * answer comes the Pi's IPv4 address on its network, for the About page (null when it has none or didn't say).
 */
export type WifiState =
  | { state: 'loading' }
  | { state: 'connected'; ssid: string; address: string | null }
  | { state: 'disconnected'; address: string | null }
  | { state: 'unknown' };

/**
 * Asks the kiosk which network it is on when the settings open, and again each time `recheck` is called (after the
 * Wi-Fi page joined one). Off the kiosk nothing is asked.
 */
export function useWifi(enabled: boolean): [wifi: WifiState, recheck: () => void] {
  const [wifi, setWifi] = useState<WifiState>({ state: enabled ? 'loading' : 'unknown' });
  const [asked, setAsked] = useState(0);
  const recheck = useCallback(() => setAsked(count => count + 1), []);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void currentWifi(controller.signal).then(answer => {
      if (controller.signal.aborted) return;
      if (answer === undefined) setWifi({ state: 'unknown' });
      else if (answer.ssid === null) setWifi({ state: 'disconnected', address: answer.address });
      else setWifi({ state: 'connected', ssid: answer.ssid, address: answer.address });
    });
    return () => controller.abort();
  }, [enabled, asked]);
  return [wifi, recheck];
}

/** What the settings say about the network; nothing while the kiosk is still being asked. */
export function wifiLabel(wifi: WifiState, t: Translate): string | undefined {
  if (wifi.state === 'connected') return wifi.ssid;
  if (wifi.state === 'disconnected') return t('wifi.not_connected');
  if (wifi.state === 'unknown') return t('wifi.unknown');
  return undefined;
}
