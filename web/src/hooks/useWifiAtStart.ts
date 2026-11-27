import { useEffect, useRef, useState } from 'react';
import { currentWifi } from '../utils/kiosk';

/** How often the kiosk's Wi-Fi is asked about while the app waits for it, or waits on the Wi-Fi page. */
const WIFI_POLL_MS = 3000;
/** How long the Wi-Fi may take to come up after a start before the app asks for a network: NetworkManager needs a while. */
const WIFI_GRACE_MS = 20_000;

/**
 * Whether the kiosk started with no Wi-Fi network: true once its service has said "no network" for WIFI_GRACE_MS from
 * the start, when `onNeeded` is called. When a kiosk that started without a network gets one with an address (joined on
 * the Wi-Fi page, or back by itself, as when the router comes on), `onConnected` is called, so that what failed to load
 * at the start can load again. Asks the service itself, not the browser: Chromium counts any interface with an address
 * (Tailscale's keeps one) as online, so `navigator.onLine` stays true with the router off. Off the kiosk nothing is
 * asked.
 */
export function useWifiAtStart(enabled: boolean, handlers: { onNeeded: () => void; onConnected: () => void }): boolean {
  const [needsWifi, setNeedsWifi] = useState(false);
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const startedAt = Date.now();
    let needed = false;
    let offline = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      const answer = await currentWifi(controller.signal);
      if (controller.signal.aborted) return;
      if (typeof answer?.ssid === 'string' && answer.address !== null) {
        // On a network with an address: nothing more to wait for.
        if (offline) {
          setNeedsWifi(false);
          handlersRef.current.onConnected();
        }
        return;
      }
      if (answer !== undefined) offline = true;
      if (!needed && answer?.ssid === null && Date.now() - startedAt >= WIFI_GRACE_MS) {
        needed = true;
        setNeedsWifi(true);
        handlersRef.current.onNeeded();
      }
      timer = setTimeout(() => void ask(), WIFI_POLL_MS);
    };
    void ask();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [enabled]);
  return needsWifi;
}
