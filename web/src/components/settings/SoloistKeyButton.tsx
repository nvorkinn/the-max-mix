import { useId, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useSoloistKey } from '../../hooks/useSoloistKey';
import { useT } from '../../i18n/translate';
import Modal from '../Modal';
import QrCode from '../QrCode';

/**
 * A person's Spotify Soloist API key, while they have none saved: a button that shows a code to scan, which opens the
 * settings site's page for the key on their phone. Once the key is there the button and its dialog go; where no key can
 * be saved from here, neither shows.
 */
export default function SoloistKeyButton({ spotifyId, name }: Readonly<{ spotifyId: string; name: string }>) {
  const t = useT();
  const [isAsking, setIsAsking] = useState(false);
  const key = useSoloistKey(spotifyId, isAsking);
  const titleId = useId();
  if (key === 'unavailable' || key === 'saved') return null;
  return (
    <>
      <button type="button" className="button button-secondary soloist-key-button" onClick={() => setIsAsking(true)}>
        <KeyRound className="w-5 h-5" aria-hidden="true" />
        <span>{t('soloist.add_key')}</span>
      </button>
      {isAsking && (
        <Modal
          labelledBy={titleId}
          onClose={() => setIsAsking(false)}
          className="app-modal-panel search-dialog soloist-key-dialog border rounded-3xl p-6 shadow-2xl text-left select-none"
        >
          <div className="modal-header">
            <h3 id={titleId} className="text-lg font-semibold truncate">
              {t('soloist.key_of', { name })}
            </h3>
          </div>
          {typeof key === 'object' && (
            <QrCode text={key.pageUrl} label={t('soloist.key_of', { name })} className="soloist-key-qr" />
          )}
          <div className="search-dialog-actions">
            <button type="button" onClick={() => setIsAsking(false)} className="button button-secondary">
              {t('common.back')}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
