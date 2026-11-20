import { CircleAlert } from 'lucide-react';
import { useT } from '../i18n/translate';
import type { StringId } from '../i18n/strings';
import Modal from './Modal';

const MESSAGES: Readonly<Record<string, StringId>> = {
  taken: 'registration.taken'
};

/** Says why adding this screen to countdown-server failed, with a way to try again. */
export default function RegistrationProblem({
  error,
  onRetry,
  onClose
}: Readonly<{ error: string; onRetry: () => void; onClose: () => void }>) {
  const t = useT();
  const message = MESSAGES[error];
  return (
    <Modal
      labelledBy="registration-problem-title"
      onClose={onClose}
      className="app-modal-panel border rounded-3xl p-6 max-w-md relative shadow-2xl text-left select-none"
    >
      <div className="modal-header mb-2">
        <h3 id="registration-problem-title" className="text-lg font-semibold flex items-center gap-2">
          <CircleAlert className="w-5 h-5 text-accent" aria-hidden="true" />
          {t('registration.title')}
        </h3>
      </div>
      {message && <p className="text-sm">{t(message)}</p>}
      <div className="mt-5 flex gap-3">
        <button
          type="button"
          data-modal-autofocus
          onClick={onRetry}
          className="spotify-sign-in flex-1 py-3 px-4 font-extrabold text-sm rounded-xl flex items-center justify-center gap-2 shadow-lg active:scale-98 transition-all"
        >
          {t('common.try_again')}
        </button>
        <button type="button" onClick={onClose} className="button button-secondary flex-1">
          {t('common.close')}
        </button>
      </div>
    </Modal>
  );
}
