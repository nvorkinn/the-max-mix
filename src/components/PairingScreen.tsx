import { AudioLines, Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  deviceSecret,
  keepDeviceId,
  pairingPageUrl,
  pairingState,
  pairingToken,
  registerScreen
} from '../countdown/registration';
import type { KioskScreen } from '../countdown/registration';
import { countdownServer } from '../countdown/server';
import { useT } from '../i18n/translate';
import QrCode from './QrCode';
import { useWifi } from './settings/wifi';
import WifiSettings from './settings/WifiSettings';

/** How often the kiosk asks whether someone owns it yet, while its QR code is showing. */
export const PAIRING_POLL_MS = 2000;
/** How long it waits before registering again when the server can't be reached or refuses for now. */
export const REGISTER_RETRY_MS = 10_000;

/** How often the Wi-Fi step asks the Pi which network it is on, so Next comes on once the Pi has joined one by itself. */
export const NETWORK_POLL_MS = 3000;

const reloadPage = () => location.reload();

/**
 * A kiosk nobody owns yet, set up in two steps over the whole app. First its Wi-Fi: the network it is on, and every way
 * to join another (Settings › Wi-Fi's page). A Pi on no network moves on once it joins one; one already on a network
 * has Next, which changes nothing. The second step says which network the Pi is on, so the move is plain. Then a QR code of
 * countdown-server's pairing page with the kiosk's pairing token: whoever scans it signs in on their phone and becomes
 * the owner. Meanwhile the kiosk registers itself (a device nobody owns) and asks every couple of seconds whether it has
 * an owner, then keeps its device ID and calls `onPaired`. The steps' dialogs open above it.
 */
export default function PairingScreen({
  screen,
  onPaired = reloadPage
}: Readonly<{ screen: KioskScreen; onPaired?: () => void }>) {
  const t = useT();
  const [address, setAddress] = useState<string | null>(null);
  const [isWifiStep, setIsWifiStep] = useState(true);
  const [wifi, recheckWifi] = useWifi(isWifiStep);
  // A Pi that was on no network moves on by itself once it is on one (joined here, or back by itself); one that was on a
  // network from the start shows Next, which changes nothing.
  const [wasOffline, setWasOffline] = useState(false);
  if (!wasOffline && wifi.state === 'disconnected') setWasOffline(true);
  if (isWifiStep && wasOffline && wifi.state === 'connected') setIsWifiStep(false);
  // The Pi may join a saved network by itself (as at boot) while the step is open.
  useEffect(() => {
    if (!isWifiStep) return;
    const timer = setInterval(recheckWifi, NETWORK_POLL_MS);
    return () => clearInterval(timer);
  }, [isWifiStep, recheckWifi]);

  useEffect(() => {
    if (isWifiStep) return;
    let stopped = false;
    // Read through a call, so each step sees whether the screen has gone while it waited.
    const gone = () => stopped;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let deviceId: string | null = null;
    const server = countdownServer();
    const secret = deviceSecret();

    void pairingToken(secret).then(token => {
      if (server && !gone()) setAddress(pairingPageUrl(server, token));
    });

    // Registers (again, when the server can't be reached or has forgotten the screen), then asks whether someone owns
    // it, until someone does.
    const step = async (): Promise<void> => {
      deviceId ??= await registerScreen(secret, screen);
      if (gone()) return;
      if (!deviceId) {
        timer = setTimeout(() => void step(), REGISTER_RETRY_MS);
        return;
      }
      const state = await pairingState(secret);
      if (gone()) return;
      if (state === 'paired') {
        if (keepDeviceId(deviceId)) onPaired();
        return;
      }
      if (state === 'unregistered') deviceId = null;
      timer = setTimeout(() => void step(), PAIRING_POLL_MS);
    };
    void step();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [screen, onPaired, isWifiStep]);

  const brand = (
    <div className="pairing-screen-brand">
      <span className="pairing-screen-mark" aria-hidden="true">
        <AudioLines className="lucide" />
      </span>
      <span className="pairing-screen-name">The Max Mix.</span>
    </div>
  );
  if (isWifiStep) {
    return (
      <main className="pairing-screen pairing-screen-wifi" aria-label={t('pairing.title')}>
        {brand}
        <p className="pairing-screen-intro">{t('pairing.wifi_intro')}</p>
        <div className="pairing-screen-wifi-settings">
          <WifiSettings wifi={wifi} onJoined={recheckWifi} />
        </div>
        {!wasOffline && (
          <button
            type="button"
            // Off the Pi's service (it can't say), nothing is to be set up here.
            disabled={wifi.state !== 'connected' && wifi.state !== 'unknown'}
            onClick={() => setIsWifiStep(false)}
            className="button search-dialog-confirm pairing-screen-next"
          >
            {t('common.next')}
          </button>
        )}
      </main>
    );
  }
  return (
    <main className="pairing-screen" aria-label={t('pairing.title')}>
      {brand}
      {wifi.state === 'connected' && (
        <p className="pairing-screen-network" role="status">
          <Check className="lucide" aria-hidden="true" />
          {t('pairing.connected', { ssid: wifi.ssid })}
        </p>
      )}
      {address && (
        <>
          <QrCode text={address} className="pairing-screen-code" label={t('pairing.code')} />
          <p className="pairing-screen-hint">{t('pairing.scan')}</p>
        </>
      )}
    </main>
  );
}
