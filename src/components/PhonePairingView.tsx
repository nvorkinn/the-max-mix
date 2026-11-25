import type { ReactNode } from 'react';
import { LoaderCircle, Smartphone } from 'lucide-react';
import type { PairingStatus } from '../utils/bluetoothMonitor';
import { useT } from '../i18n/translate';

/** A pairing code as the iPhone shows it: six digits. */
const formatCode = (code: number) => String(code).padStart(6, '0');
const PLACES = [0, 1, 2, 3, 4, 5] as const;

/**
 * The code the phone asks to confirm, each digit in its own box across the sheet; once it is confirmed on the phone, a
 * spinner in its place until the Pi has finished pairing.
 */
function PairingCode({ code, isConfirmed }: Readonly<{ code: number | null; isConfirmed: boolean }>) {
  const t = useT();
  if (isConfirmed) {
    return (
      <div className="pair-phone-code">
        <LoaderCircle
          className="pair-phone-confirmed-spinner animate-spin"
          role="status"
          aria-label={t('pair.pairing')}
        />
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
 * What to do on the phone before the Pi starts looking: it hears a phone best when Settings › Bluetooth is already open
 * on it as the scan starts.
 */
export function PairPhoneSteps() {
  const t = useT();
  return (
    <ol className="pair-phone-steps">
      <li>{t('pair.step_settings')}</li>
      <li>{t('pair.step_bluetooth')}</li>
      <li>{t('pair.step_ok')}</li>
    </ol>
  );
}

/**
 * Where pairing a phone stands (hooks/usePhonePairing.ts): while a phone is pairing, its name and the code to accept;
 * before that, `children` (what to do on the phone) and the phones the Pi hears, each a button that pairs it.
 */
export default function PhonePairingView({
  pairing,
  onPick,
  children
}: Readonly<{ pairing: PairingStatus; onPick: (address: string, name: string) => void; children?: ReactNode }>) {
  const t = useT();
  if (pairing.state === 'pairing') {
    return (
      <div className="pair-phone-pairing" aria-live="polite">
        <p className="pair-phone-pairing-name">{pairing.name}</p>
        {pairing.code !== null && !pairing.isConfirmed && <p className="pair-phone-confirm">{t('pair.accept')}</p>}
        <PairingCode code={pairing.code} isConfirmed={pairing.isConfirmed} />
      </div>
    );
  }
  return (
    <>
      {children}
      <ul
        className="phone-picker-options pair-phone-nearby"
        aria-label={t('pair.nearby')}
        aria-busy={pairing.state !== 'scanning'}
      >
        {pairing.state === 'scanning' &&
          pairing.nearby.map(device => (
            <li key={device.address}>
              <button
                type="button"
                className="modal-option phone-picker-option pair-phone-device"
                onClick={() => onPick(device.address, device.name)}
              >
                <Smartphone className="w-5 h-5" aria-hidden="true" />
                {device.name}
              </button>
            </li>
          ))}
      </ul>
    </>
  );
}
