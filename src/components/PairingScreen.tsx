import { AudioLines } from 'lucide-react';
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
import { currentWifi } from '../utils/kiosk';
import QrCode from './QrCode';

/** How often the kiosk asks whether someone owns it yet, while its QR code is showing. */
export const PAIRING_POLL_MS = 2000;
/** How long it waits before registering again when the server can't be reached or refuses for now. */
export const REGISTER_RETRY_MS = 10_000;

/** How often the screen asks the Pi whether it is on a network. */
export const NETWORK_POLL_MS = 3000;
/**
 * How long the Pi may say it is on no network before the QR code makes way for Settings › Wi-Fi, which the app opens
 * after as long (hooks/useWifiAtStart.ts): NetworkManager needs a while after a start.
 */
export const NO_NETWORK_MS = 20_000;

const reloadPage = () => location.reload();

/**
 * False once the Pi has said it is on no Wi-Fi network for NO_NETWORK_MS, until it is on one with an address again. True
 * while the Pi's service can't be asked: only its own "no network" counts.
 */
function useHasNetwork(): boolean {
  const [hasNetwork, setHasNetwork] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    const aborted = () => controller.signal.aborted;
    let offSince: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async (): Promise<void> => {
      const answer = await currentWifi(controller.signal);
      if (aborted()) return;
      if (answer?.ssid === null) {
        offSince ??= Date.now();
        if (Date.now() - offSince >= NO_NETWORK_MS) setHasNetwork(false);
      } else if (answer && answer.address !== null) {
        offSince = null;
        setHasNetwork(true);
      }
      timer = setTimeout(() => void ask(), NETWORK_POLL_MS);
    };
    void ask();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  return hasNetwork;
}

/**
 * A kiosk nobody owns yet: the brand and a QR code of countdown-server's pairing page with the kiosk's pairing token.
 * Whoever scans it signs in on their phone and becomes the owner; meanwhile the kiosk registers itself (a device nobody
 * owns) and asks every couple of seconds whether it has an owner, then keeps its device ID and calls `onPaired`. It
 * covers the app but not its dialogs. On a Pi with no network it makes way for the app, which opens on Settings › Wi-Fi
 * (nobody could add it from their phone then anyway), and comes back once the Pi is on one.
 */
export default function PairingScreen({
  screen,
  onPaired = reloadPage
}: Readonly<{ screen: KioskScreen; onPaired?: () => void }>) {
  const t = useT();
  const [address, setAddress] = useState<string | null>(null);
  const hasNetwork = useHasNetwork();

  useEffect(() => {
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
  }, [screen, onPaired]);

  if (!hasNetwork) return null;
  return (
    <main className="pairing-screen" aria-label={t('pairing.title')}>
      <div className="pairing-screen-brand">
        <span className="pairing-screen-mark" aria-hidden="true">
          <AudioLines className="lucide" />
        </span>
        <span className="pairing-screen-name">The Max Mix.</span>
      </div>
      {address && (
        <>
          <QrCode text={address} className="pairing-screen-code" label={t('pairing.code')} />
          <p className="pairing-screen-hint">{t('pairing.scan')}</p>
        </>
      )}
    </main>
  );
}
