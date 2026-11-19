import { useEffect, useState } from 'react';
import { Bluetooth, Check, LoaderCircle, Smartphone } from 'lucide-react';
import { pairPhone, pickPhone, readBluetoothReport } from '../utils/bluetoothMonitor';
import type { PairingStatus } from '../utils/bluetoothMonitor';
import { errorMessage } from '../utils/errorMessage';
import { setPersonPhone } from '../utils/phoneLinks';
import Modal from './Modal';
import PersonFace from './PersonFace';

/** How often the sheet asks the Pi what it hears and how pairing is going. */
const POLL_MS = 1500;

/** A pairing code as the iPhone shows it: six digits. */
const formatCode = (code: number) => String(code).padStart(6, '0');
const PLACES = [0, 1, 2, 3, 4, 5] as const;

/**
 * The code the phone asks to confirm, each digit in its own box across the sheet; once it is confirmed on the phone, a
 * spinner in its place until the Pi has finished pairing.
 */
function PairingCode({ code, isConfirmed }: Readonly<{ code: number | null; isConfirmed: boolean }>) {
  if (isConfirmed) {
    return (
      <div className="pair-phone-code">
        <LoaderCircle className="pair-phone-confirmed-spinner animate-spin" role="status" aria-label="Pairing" />
      </div>
    );
  }
  if (code === null) return null;
  const digits = formatCode(code);
  return (
    <div className="pair-phone-code" role="group" aria-label={digits}>
      {PLACES.map(place => (
        <span key={place} className="pair-phone-digit" aria-hidden="true">
          {digits[place]}
        </span>
      ))}
    </div>
  );
}

/**
 * Pairs a person's phone with the kiosk (pi/kiosk-audio/phone-pairing.ts). It first says what pairing is for, and the
 * Pi only starts looking once that is OK'd. While the sheet is looking, a
 * phone with Settings › Bluetooth open shows up in the list under its own name. Tapping it pairs: the phone asks to
 * accept the code shown here too, and the phone is linked to that person (linkPhone), so the switcher knows when they
 * are here; the sheet then says so until Done. Skip (or closing the sheet) stops the Pi looking.
 */
export default function PairPhoneSheet({
  spotifyId,
  name,
  imageUrl = '',
  onDone
}: Readonly<{ spotifyId: string; name: string; imageUrl?: string; onDone: () => void }>) {
  const [isIntro, setIsIntro] = useState(true);
  const [pairing, setPairing] = useState<PairingStatus>({ state: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (isIntro) return;
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
  }, [spotifyId, attempt, isIntro]);

  if (pairing.state === 'paired') {
    return (
      <Modal labelledBy="pair-phone-title" onClose={onDone} className="app-modal-panel pair-phone-sheet">
        <div className="pair-phone-done">
          <h3 id="pair-phone-title" className="pair-phone-big-title">
            You’re all set!
          </h3>
          <div className="pair-phone-face">
            <PersonFace name={name} imageUrl={imageUrl} className="pair-phone-face-picture" />
            <Check className="pair-phone-face-tick" aria-hidden="true" />
          </div>
          <p className="pair-phone-big-text">Tap your photo any time to switch between accounts!</p>
        </div>
        <div className="pair-phone-actions">
          <button
            type="button"
            data-modal-autofocus
            className="spotify-sign-in pair-phone-button font-extrabold rounded-xl"
            onClick={onDone}
          >
            Awesome!
          </button>
        </div>
      </Modal>
    );
  }
  const owner = name ? `${name}’s` : 'your';
  const title = `Pair ${owner} phone`;
  if (isIntro) {
    return (
      <Modal labelledBy="pair-phone-title" onClose={onDone} className="app-modal-panel pair-phone-sheet">
        <div className="pair-phone-header">
          <h3 id="pair-phone-title" className="pair-phone-title">
            <Bluetooth className="w-7 h-7 text-accent" aria-hidden="true" />
            {title}
          </h3>
        </div>
        <div className="pair-phone-body pair-phone-intro">
          <p className="pair-phone-big-title">Your phone is your key!</p>
          <p className="pair-phone-big-text">
            Once it’s paired, the tablet knows the moment you walk in, and only you can switch to your account.
          </p>
        </div>
        <div className="pair-phone-actions">
          <button
            type="button"
            data-modal-autofocus
            className="spotify-sign-in pair-phone-button font-extrabold rounded-xl"
            onClick={() => setIsIntro(false)}
          >
            Let’s do it!
          </button>
        </div>
      </Modal>
    );
  }

  const pick = (address: string, phoneName: string) => {
    setPairing({ state: 'pairing', name: phoneName, code: null, isConfirmed: false });
    pickPhone(address).catch((caught: unknown) => setError(errorMessage(caught)));
  };

  // After the intro, the Pi is busy until the phone shows its code: starting, looking, then pairing. Once the code is
  // confirmed on the phone, the big spinner in the code's place takes over.
  const isBusy =
    !error &&
    (pairing.state === 'idle' ||
      pairing.state === 'scanning' ||
      (pairing.state === 'pairing' && pairing.code === null && !pairing.isConfirmed));

  return (
    <Modal labelledBy="pair-phone-title" onClose={onDone} className="app-modal-panel pair-phone-sheet">
      <div className="pair-phone-header">
        <h3 id="pair-phone-title" className="pair-phone-title">
          <Bluetooth className="w-7 h-7 text-accent" aria-hidden="true" />
          {title}
        </h3>
        {isBusy && (
          <LoaderCircle className="pair-phone-spinner w-8 h-8 animate-spin" role="status" aria-label="Searching" />
        )}
      </div>
      <div className="pair-phone-body">
        {!error && pairing.state === 'pairing' ? (
          <div className="pair-phone-pairing" aria-live="polite">
            <p className="pair-phone-pairing-name">{pairing.name}</p>
            {pairing.code !== null && !pairing.isConfirmed && (
              <p className="pair-phone-confirm">Accept the pairing request on your phone.</p>
            )}
            <PairingCode code={pairing.code} isConfirmed={pairing.isConfirmed} />
          </div>
        ) : (
          !error && (
            <>
              <ol className="pair-phone-steps">
                <li>Open Settings</li>
                <li>Open Bluetooth</li>
                <li>Tap your phone in the list below</li>
              </ol>
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
