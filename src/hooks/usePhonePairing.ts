import { useEffect, useState } from 'react';
import { pairPhone, pickPhone, readBluetoothReport } from '../utils/bluetoothMonitor';
import type { PairingStatus } from '../utils/bluetoothMonitor';
import { errorMessage } from '../utils/errorMessage';
import { setPersonPhone } from '../utils/phoneLinks';

/** How often the Pi is asked what it hears and how pairing is going. */
const POLL_MS = 1500;

export interface PhonePairing {
  readonly pairing: PairingStatus;
  readonly error: string | null;
  /** Pairs the phone tapped in the list. */
  readonly pick: (address: string, name: string) => void;
  /** Starts looking again after an error. */
  readonly retry: () => void;
}

/**
 * Pairs a person's phone with the kiosk (pi/kiosk-audio/phone-pairing.ts) while `isLooking`: the Pi looks for phones
 * with Settings › Bluetooth open, and the one tapped is paired and linked to the person (setPersonPhone), so the
 * switcher knows when they are here. Stopping before a phone is paired (or unmounting) stops the Pi looking.
 */
export function usePhonePairing(spotifyId: string, isLooking: boolean): PhonePairing {
  const [pairing, setPairing] = useState<PairingStatus>({ state: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isLooking) return;
    let isCurrent = true;
    // Only a pairing that this started counts: the Pi keeps reporting the last phone paired until the next start.
    let hasStarted = false;
    let isWaiting = true;
    pairPhone(true)
      .then(() => {
        hasStarted = true;
      })
      .catch((caught: unknown) => {
        if (isCurrent) setError(errorMessage(caught));
      });
    const timer = setInterval(() => {
      if (!hasStarted) return;
      readBluetoothReport()
        .then(report => {
          if (!isCurrent) return;
          setPairing(report.pairing);
          if (report.pairing.state === 'paired') {
            isWaiting = false;
            clearInterval(timer);
            setPersonPhone(spotifyId, report.pairing.address);
          } else if (report.pairing.state === 'failed') {
            isWaiting = false;
            setError(report.pairing.error);
          }
        })
        .catch(() => null);
    }, POLL_MS);
    return () => {
      isCurrent = false;
      clearInterval(timer);
      if (hasStarted && isWaiting) void pairPhone(false).catch(() => null);
    };
  }, [spotifyId, attempt, isLooking]);

  return {
    pairing,
    error,
    pick: (address, name) => {
      setPairing({ state: 'pairing', name, code: null, isConfirmed: false });
      pickPhone(address).catch((caught: unknown) => setError(errorMessage(caught)));
    },
    retry: () => {
      setError(null);
      setPairing({ state: 'idle' });
      setAttempt(value => value + 1);
    }
  };
}
