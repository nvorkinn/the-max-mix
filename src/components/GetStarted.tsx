import { useState } from 'react';
import { reloadSettings } from '../spotify/settings';
import { useT } from '../i18n/translate';
import Modal from './Modal';
import SpotifyIcon from './SpotifyIcon';
import SpotifySignInDialog from './SpotifySignInDialog';

/**
 * Over the Dashboard of a kiosk nobody has signed in to Spotify on yet: the first sign-in, straight from the screen the
 * kiosk opens on, so nobody has to find it under the Spotify tab or Settings. Not now closes it until the next start.
 */
export default function GetStarted({ offline, onClose }: Readonly<{ offline: boolean; onClose: () => void }>) {
  const t = useT();
  const [signingIn, setSigningIn] = useState(false);
  if (signingIn) return <SpotifySignInDialog onSignedIn={reloadSettings} onClose={() => setSigningIn(false)} />;
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
      {offline && <p className="text-sm">{t('setup.offline')}</p>}
      <div className="mt-5 flex gap-3">
        <button
          type="button"
          data-modal-autofocus
          disabled={offline}
          onClick={() => setSigningIn(true)}
          className="spotify-sign-in flex-1 py-3 px-4 font-extrabold text-sm rounded-xl flex items-center justify-center gap-2 shadow-lg active:scale-98 transition-all"
        >
          <SpotifyIcon className="w-5 h-5" />
          {t('setup.connect')}
        </button>
        <button type="button" onClick={onClose} className="button button-secondary flex-1">
          {t('common.not_now')}
        </button>
      </div>
    </Modal>
  );
}
