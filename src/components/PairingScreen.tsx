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
import QrCode from './QrCode';

/** How often the kiosk asks whether someone owns it yet, while its QR code is showing. */
export const PAIRING_POLL_MS = 2000;
/** How long it waits before registering again when the server can't be reached or refuses for now. */
export const REGISTER_RETRY_MS = 10_000;

const reloadPage = () => location.reload();

const wait = (ms: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });

/**
 * A kiosk nobody owns yet: the brand and a QR code of countdown-server's pairing page with the kiosk's pairing token.
 * Whoever scans it signs in on their phone and becomes the owner; meanwhile the kiosk registers itself (a device nobody
 * owns) and asks every couple of seconds whether it has an owner, then keeps its device ID and calls `onPaired`. It
 * covers the app but not its dialogs, so Settings > Wi-Fi still opens over it on a kiosk with no network.
 */
export default function PairingScreen({
  screen,
  onPaired = reloadPage
}: Readonly<{ screen: KioskScreen; onPaired?: () => void }>) {
  const t = useT();
  const [address, setAddress] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    const server = countdownServer();
    const secret = deviceSecret();

    void pairingToken(secret).then(token => {
      if (!stopped && server) setAddress(pairingPageUrl(server, token));
    });

    const run = async () => {
      let deviceId: string | null = null;
      while (!stopped) {
        deviceId ??= await registerScreen(secret, screen);
        if (stopped) return;
        if (!deviceId) {
          await wait(REGISTER_RETRY_MS);
          continue;
        }
        const state = await pairingState(secret);
        if (stopped) return;
        if (state === 'paired') {
          if (keepDeviceId(deviceId)) onPaired();
          return;
        }
        if (state === 'unregistered') deviceId = null;
        await wait(PAIRING_POLL_MS);
      }
    };
    void run();
    return () => {
      stopped = true;
    };
  }, [screen, onPaired]);

  return (
    <main className="pairing-screen" aria-label={t('pairing.title')}>
      <div className="pairing-screen-brand">
        <span className="pairing-screen-mark" aria-hidden="true">
          <AudioLines className="lucide" />
        </span>
        <span className="pairing-screen-name">The Max Mix.</span>
      </div>
      {address && <QrCode text={address} className="pairing-screen-code" label={t('pairing.code')} />}
    </main>
  );
}
