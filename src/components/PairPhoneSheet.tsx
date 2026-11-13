import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Bluetooth } from 'lucide-react';
import { linkPhone } from '../spotify/auth';
import { pairPhone, readBluetoothReport } from '../utils/bluetoothMonitor';
import { errorMessage } from '../utils/errorMessage';
import Modal from './Modal';

/** How often the sheet asks the Pi whether a phone has paired. */
const POLL_MS = 1500;

/**
 * Pairs a person's iPhone with the kiosk: the Pi advertises as THE MAX MIX ("Pair my phone", pi/kiosk-audio/phone-pairing.ts)
 * while the sheet is open, and the phone that pairs is linked to that person (linkPhone), so the switcher knows when
 * they are here. Skip (or closing the sheet) stops the Pi advertising.
 */
export default function PairPhoneSheet({
  spotifyId,
  name,
  onDone
}: Readonly<{ spotifyId: string; name: string; onDone: () => void }>) {
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
        .then(({ pairing }) => {
          if (!isCurrent) return;
          if (pairing.state === 'paired') {
            isWaiting = false;
            linkPhone(spotifyId, pairing.address);
            onDoneRef.current();
          } else if (pairing.state === 'failed') {
            isWaiting = false;
            setError(pairing.error);
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

  return (
    <Modal labelledBy="pair-phone-title" onClose={onDone} className="app-modal-panel pair-phone-sheet">
      <h3 id="pair-phone-title" className="pair-phone-title">
        <Bluetooth className="w-7 h-7 text-accent" aria-hidden="true" />
        Pair {name ? `${name}’s` : 'your'} iPhone
      </h3>
      <ol className="pair-phone-steps">
        <li>Settings › Bluetooth</li>
        <li>THE MAX MIX</li>
        <li>Pair</li>
      </ol>
      {error && (
        <p role="alert" className="settings-error status-danger">
          {error}
        </p>
      )}
      <div className="pair-phone-actions">
        {error && (
          <button
            type="button"
            className="spotify-sign-in pair-phone-button font-extrabold rounded-xl"
            onClick={() => {
              setError(null);
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
