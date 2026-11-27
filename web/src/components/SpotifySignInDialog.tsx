import { useId } from 'react';
import { usePhoneSignIn } from '../hooks/usePhoneSignIn';
import { useT } from '../i18n/translate';
import Modal from './Modal';
import QrCode from './QrCode';

/**
 * Signing in to Spotify on a phone: a QR code that opens Spotify's sign-in on the phone that scans it. Once the phone is
 * back, the kiosk finishes the sign-in and calls `onSignedIn`. With `as`, it signs that person in again.
 */
export default function SpotifySignInDialog({
  as,
  onSignedIn,
  onClose
}: Readonly<{ as?: string | undefined; onSignedIn: () => void; onClose: () => void }>) {
  const t = useT();
  const titleId = useId();
  const { code, error } = usePhoneSignIn(onSignedIn, as);
  return (
    <Modal
      labelledBy={titleId}
      onClose={onClose}
      className="app-modal-panel search-dialog spotify-sign-in-dialog border rounded-3xl p-6 shadow-2xl text-left select-none"
    >
      <div className="modal-header">
        <h3 id={titleId} className="text-lg font-semibold truncate">
          {t('spotify.sign_in_title')}
        </h3>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {code === 'unavailable' && <p className="text-sm">{t('spotify.sign_in_unavailable')}</p>}
      {typeof code === 'object' && (
        <QrCode text={code.pageUrl} label={t('spotify.sign_in_title')} className="spotify-sign-in-qr" />
      )}
      <div className="search-dialog-actions">
        <button type="button" data-modal-autofocus onClick={onClose} className="button button-secondary">
          {t('common.back')}
        </button>
      </div>
    </Modal>
  );
}
