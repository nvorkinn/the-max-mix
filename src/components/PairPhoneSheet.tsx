import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Bluetooth, LoaderCircle, Smartphone } from 'lucide-react';
import { pairPhone, pickPhone, readBluetoothReport } from '../utils/bluetoothMonitor';
import type { PairingStatus } from '../utils/bluetoothMonitor';
import { errorMessage } from '../utils/errorMessage';
import { setPersonPhone } from '../utils/phoneLinks';
import Modal from './Modal';

/** How often the sheet asks the Pi what it hears and how pairing is going. */
const POLL_MS = 1500;

/** A pairing code as the iPhone shows it: six digits. */
const formatCode = (code: number) => String(code).padStart(6, '0');

/**
 * Pairs a person's iPhone with the kiosk (pi/kiosk-audio/phone-pairing.ts). While the sheet is open the Pi looks for
 * phones; with Settings › Bluetooth open, the iPhone shows up in the list under its own name. Tapping it pairs: the phone
 * asks to confirm the code shown here too, and the phone is linked to that person (linkPhone), so the switcher knows
 * when they are here. Skip (or closing the sheet) stops the Pi looking.
 */
export default function PairPhoneSheet({
  spotifyId,
  name,
  onDone
}: Readonly<{ spotifyId: string; name: string; onDone: () => void }>) {
  const [pairing, setPairing] = useState<PairingStatus>({ state: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const onDoneRef = useRef(onDone);
  useLayoutEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    let isCurrent = true;
    // Only a pairing that this sheet started counts: the Pi keeps reporting the last phone paired until the next start.
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
            setPersonPhone(spotifyId, report.pairing.address);
            onDoneRef.current();
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
  }, [spotifyId, attempt]);

  const pick = (address: string, phoneName: string) => {
    setPairing({ state: 'pairing', name: phoneName, code: null });
    pickPhone(address).catch((caught: unknown) => setError(errorMessage(caught)));
  };

  // The Pi is busy from the moment the sheet opens until the phone shows its code: starting, looking, then pairing.
  const isBusy =
    !error &&
    (pairing.state === 'idle' ||
      pairing.state === 'scanning' ||
      (pairing.state === 'pairing' && pairing.code === null));

  return (
    <Modal labelledBy="pair-phone-title" onClose={onDone} className="app-modal-panel pair-phone-sheet">
      <div className="pair-phone-header">
        <h3 id="pair-phone-title" className="pair-phone-title">
          <Bluetooth className="w-7 h-7 text-accent" aria-hidden="true" />
          Pair {name ? `${name}’s` : 'your'} iPhone
        </h3>
        {isBusy && (
          <LoaderCircle className="pair-phone-spinner w-8 h-8 animate-spin" role="status" aria-label="Searching" />
        )}
      </div>
      <div className="pair-phone-body">
        {!error && pairing.state === 'pairing' ? (
          <div className="pair-phone-pairing" aria-live="polite">
            <p className="pair-phone-pairing-name">{pairing.name}</p>
            {pairing.code !== null && <p className="pair-phone-code">{formatCode(pairing.code)}</p>}
          </div>
        ) : (
          !error && (
            <>
              <p className="pair-phone-step">
                Open Settings › Bluetooth on your iPhone and stay on that screen. Then tap your iPhone in the list
                below.
              </p>
              <ul
                className="phone-picker-options pair-phone-nearby"
                aria-label="Nearby"
                aria-busy={pairing.state !== 'scanning'}
              >
                {pairing.state === 'scanning' &&
                  pairing.nearby.map(device => (
                    <li key={device.address}>
                      <button
                        type="button"
                        className="modal-option phone-picker-option pair-phone-device"
                        onClick={() => pick(device.address, device.name)}
                      >
                        <Smartphone className="w-5 h-5" aria-hidden="true" />
                        {device.name}
                      </button>
                    </li>
                  ))}
              </ul>
            </>
          )
        )}
        {error && (
          <p role="alert" className="settings-error status-danger">
            {error}
          </p>
        )}
      </div>
      <div className="pair-phone-actions">
        {error && (
          <button
            type="button"
            className="spotify-sign-in pair-phone-button font-extrabold rounded-xl"
            onClick={() => {
              setError(null);
              setPairing({ state: 'idle' });
              setAttempt(value => value + 1);
            }}
          >
            Try again
          </button>
        )}
        <button
          type="button"
          data-modal-autofocus
          className="button button-secondary pair-phone-button"
          onClick={onDone}
        >
          Skip
        </button>
      </div>
    </Modal>
  );
}
