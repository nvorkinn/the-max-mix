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
