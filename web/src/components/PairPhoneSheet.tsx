import { useState } from 'react';
import { Bluetooth, Check, LoaderCircle } from 'lucide-react';
import { usePhonePairing } from '../hooks/usePhonePairing';
import { useT } from '../i18n/translate';
import Modal from './Modal';
import PersonFace from './PersonFace';
import PhonePairingView, { PairPhoneSteps } from './PhonePairingView';

/**
 * Pairs a person's phone with the kiosk (server/src/phone-pairing.ts). It first has them open Settings › Bluetooth
 * on the phone, and the Pi only starts looking once that is OK'd, so the phone is listening for the whole scan. While
 * the sheet is looking, the phone shows up in the list under its own name. Tapping it pairs: the phone asks to
 * accept the code shown here too, and the phone is linked to that person (linkPhone), so the switcher knows when they
 * are here; the sheet then says so until Done. Skip (or closing the sheet) stops the Pi looking.
 */
export default function PairPhoneSheet({
  spotifyId,
  name,
  imageUrl = '',
  onDone
}: Readonly<{ spotifyId: string; name: string; imageUrl?: string; onDone: () => void }>) {
  const t = useT();
  const [isIntro, setIsIntro] = useState(true);
  const { pairing, error, pick, retry } = usePhonePairing(spotifyId, !isIntro);

  if (pairing.state === 'paired') {
    return (
      <Modal labelledBy="pair-phone-title" onClose={onDone} className="app-modal-panel pair-phone-sheet">
        <div className="pair-phone-done">
          <h3 id="pair-phone-title" className="pair-phone-big-title">
            {t('pair.all_set')}
          </h3>
          <div className="pair-phone-face">
            <PersonFace name={name} imageUrl={imageUrl} className="pair-phone-face-picture" />
            <Check className="pair-phone-face-tick" aria-hidden="true" />
          </div>
          <p className="pair-phone-big-text">{t('pair.switch_hint')}</p>
        </div>
        <div className="pair-phone-actions">
          <button
            type="button"
            data-modal-autofocus
            className="spotify-sign-in pair-phone-button font-extrabold rounded-xl"
            onClick={onDone}
          >
            {t('pair.awesome')}
          </button>
        </div>
      </Modal>
    );
  }
  const title = name ? t('pair.title_of', { name }) : t('pair.title');
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
          <PairPhoneSteps />
        </div>
        <div className="pair-phone-actions">
          <button
            type="button"
            data-modal-autofocus
            className="spotify-sign-in pair-phone-button font-extrabold rounded-xl"
            onClick={() => setIsIntro(false)}
          >
            {t('common.ok')}
          </button>
        </div>
      </Modal>
    );
  }

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
          <LoaderCircle
            className="pair-phone-spinner w-8 h-8 animate-spin"
            role="status"
            aria-label={t('pair.searching')}
          />
        )}
      </div>
      <div className="pair-phone-body">
        {!error && <PhonePairingView pairing={pairing} onPick={pick} />}
        {error && (
          <p role="alert" className="settings-error status-danger">
            {error}
          </p>
        )}
      </div>
      <div className="pair-phone-actions">
        {error && (
          <button type="button" className="spotify-sign-in pair-phone-button font-extrabold rounded-xl" onClick={retry}>
            {t('common.try_again')}
          </button>
        )}
        <button
          type="button"
          data-modal-autofocus
          className="button button-secondary pair-phone-button"
          onClick={onDone}
        >
          {t('pair.skip')}
        </button>
      </div>
    </Modal>
  );
}
