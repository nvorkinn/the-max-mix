import { useEffect } from 'react';
import {
  deviceSecret,
  keepDeviceId,
  kioskScreen,
  pairingState,
  registerScreen,
  sendSetupReport,
  setupStart
} from '../../countdown/registration';

/** How often the kiosk asks whether someone owns it yet, while its QR code is showing. */
export const PAIRING_POLL_MS = 2000;
/** How long it waits before trying again when the Pi can't say what its screen is, or the server can't be reached. */
export const REGISTER_RETRY_MS = 10_000;

/**
 * While `isRunning`: registers the kiosk with countdown-server as a touchscreen nobody owns yet (with its screen as the
 * Pi reports it), then asks every couple of seconds whether someone owns it, which they do once they have scanned its
 * QR code and signed in on their phone. Then it keeps its device ID and calls `onPaired`.
 *
 * As soon as it is registered, before anyone owns it, the kiosk also sends its first setup report (setupStart): the
 * challenge of the Spotify sign-in its owner's phone goes on to, which a server that follows the setup makes itself.
 * A report that got no answer is sent again with the next ask.
 */
export function useRegistration(isRunning: boolean, onPaired: () => void): void {
  useEffect(() => {
    if (!isRunning) return;
    let stopped = false;
    // Read through a call, so each step sees whether it has been stopped while it waited.
    const gone = () => stopped;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let deviceId: string | null = null;
    let isReported = false;
    const secret = deviceSecret();
    const later = (ms: number) => {
      timer = setTimeout(() => void step(), ms);
    };
    // Registers (again, when the server can't be reached or has forgotten the screen), then asks whether someone owns
    // it, until someone does.
    const step = async (): Promise<void> => {
      if (!deviceId) {
        const screen = await kioskScreen();
        if (gone()) return;
        deviceId = screen && (await registerScreen(secret, screen));
        if (gone()) return;
        if (!deviceId) {
          later(REGISTER_RETRY_MS);
          return;
        }
        isReported = false;
      }
      if (!isReported) {
        isReported = (await sendSetupReport(await setupStart())) !== null;
        if (gone()) return;
      }
      const state = await pairingState(secret);
      if (gone()) return;
      if (state === 'paired') {
        if (keepDeviceId(deviceId)) onPaired();
        return;
      }
      if (state === 'unregistered') deviceId = null;
      later(PAIRING_POLL_MS);
    };
    void step();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [isRunning, onPaired]);
}
