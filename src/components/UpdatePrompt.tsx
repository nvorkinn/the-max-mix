import { Download } from 'lucide-react';
import { useT } from '../i18n/translate';
import Modal from './Modal';

/** Asks whether to update the Pi now, when a newer version is out. "Not now" is remembered for that version. */
export default function UpdatePrompt({
  newer,
  onUpdate,
  onLater
}: Readonly<{ newer: string; onUpdate: () => void; onLater: () => void }>) {
  const t = useT();
  return (
    <Modal
      labelledBy="update-prompt-title"
      onClose={onLater}
      className="app-modal-panel border rounded-3xl p-6 max-w-md relative shadow-2xl text-left select-none"
    >
      <div className="modal-header mb-2">
        <h3 id="update-prompt-title" className="text-lg font-semibold flex items-center gap-2">
          <Download className="w-5 h-5 text-accent" aria-hidden="true" />
          {t('update.available')}
        </h3>
      </div>
      <p className="text-sm font-semibold">{newer}.</p>
      <p className="mt-2 text-xs text-muted">{t('update.prompt')}</p>
      <div className="mt-5 flex gap-3">
        <button
          type="button"
          data-modal-autofocus
          onClick={onUpdate}
          className="spotify-sign-in flex-1 py-3 px-4 font-extrabold text-sm rounded-xl flex items-center justify-center gap-2 shadow-lg active:scale-98 transition-all"
        >
          {t('update.now')}
        </button>
        <button type="button" onClick={onLater} className="button button-secondary flex-1">
          {t('update.later')}
        </button>
      </div>
    </Modal>
  );
}
