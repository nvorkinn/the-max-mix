import { useState } from 'react';
import { reloadSettings } from '../spotify/settings';
import { useT } from '../i18n/translate';
import SpotifySignInDialog from './SpotifySignInDialog';

interface SpotifySetupProps {
  offline: boolean;
  signInError: string | null;
  onDetails: () => void;
}

export default function SpotifySetup({ offline, signInError, onDetails }: Readonly<SpotifySetupProps>) {
  const t = useT();
  const [signingIn, setSigningIn] = useState(false);
  return (
    <div className="spotify-setup">
      <h2>{t('setup.title')}</h2>
      {signInError && (
        <div>
          <p role="alert" className="text-danger">
            {signInError}
          </p>
          <button type="button" className="button button-secondary" onClick={onDetails}>
            {t('common.details')}
          </button>
        </div>
      )}
      {offline && <p>{t('setup.offline')}</p>}
      <button type="button" className="spotify-sign-in button" disabled={offline} onClick={() => setSigningIn(true)}>
        {t('setup.connect')}
      </button>
      {signingIn && <SpotifySignInDialog onSignedIn={reloadSettings} onClose={() => setSigningIn(false)} />}
    </div>
  );
}
