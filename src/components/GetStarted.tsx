import { useState } from 'react';
import { startSignIn } from '../spotify/auth';
import { errorMessage } from '../utils/errorMessage';
import { useT } from '../i18n/translate';
import Modal from './Modal';
import SpotifyIcon from './SpotifyIcon';

/**
 * Over the Dashboard of a kiosk nobody has signed in to Spotify on yet: the first sign-in, straight from the screen the
 * kiosk opens on, so nobody has to find it under the Spotify tab or Settings. Not now closes it until the next start.
 */
export default function GetStarted({ offline, onClose }: Readonly<{ offline: boolean; onClose: () => void }>) {
  const t = useT();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connect = () => {
    setConnecting(true);
    setError(null);
    startSignIn().catch((caught: unknown) => {
      setError(errorMessage(caught));
      setConnecting(false);
    });
  };
  return (
    <Modal
      labelledBy="get-started-title"
      onClose={onClose}
      className="app-modal-panel border rounded-3xl p-6 max-w-md relative shadow-2xl text-left select-none"
    >
      <div className="modal-header mb-2">
        <h3 id="get-started-title" className="text-lg font-semibold">
          {t('setup.title')}
        </h3>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {offline && <p className="text-sm">{t('setup.offline')}</p>}
      <div className="mt-5 flex gap-3">
        <button
          type="button"
          data-modal-autofocus
          disabled={offline || connecting}
          onClick={connect}
          className="spotify-sign-in flex-1 py-3 px-4 font-extrabold text-sm rounded-xl flex items-center justify-center gap-2 shadow-lg active:scale-98 transition-all"
        >
          <SpotifyIcon className="w-5 h-5" />
          {t(connecting ? 'setup.connecting' : 'setup.connect')}
        </button>
        <button type="button" onClick={onClose} className="button button-secondary flex-1">
          {t('common.not_now')}
        </button>
      </div>
    </Modal>
  );
}
