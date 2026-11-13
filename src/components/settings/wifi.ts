import { useEffect, useState } from 'react';
import { currentWifi } from '../../utils/kiosk';

/** The kiosk's Wi-Fi as far as its service says: still asking, on a network, on none, or it could not tell. */
export type WifiState =
  { state: 'loading' } | { state: 'connected'; ssid: string } | { state: 'disconnected' } | { state: 'unknown' };

/**
 * Asks the kiosk once, when the settings open, which network it is on. The Wi-Fi setup page replaces the app while it
 * is up and the app starts again after it, so the answer never goes stale while the settings show it. Off the kiosk
 * nothing is asked.
 */
export function useWifi(enabled: boolean): WifiState {
  const [wifi, setWifi] = useState<WifiState>({ state: enabled ? 'loading' : 'unknown' });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void currentWifi(controller.signal).then(ssid => {
      if (controller.signal.aborted) return;
      if (ssid === undefined) setWifi({ state: 'unknown' });
      else if (ssid === null) setWifi({ state: 'disconnected' });
      else setWifi({ state: 'connected', ssid });
    });
    return () => controller.abort();
  }, [enabled]);
  return wifi;
}

/** What the settings say about the network; nothing while the kiosk is still being asked. */
export function wifiLabel(wifi: WifiState): string | undefined {
  if (wifi.state === 'connected') return wifi.ssid;
  if (wifi.state === 'disconnected') return 'Not connected';
  if (wifi.state === 'unknown') return 'Status unknown';
  return undefined;
}
