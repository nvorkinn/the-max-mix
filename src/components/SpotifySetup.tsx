import { useState } from 'react';
import { startSignIn } from '../spotify/auth';
import { errorMessage } from '../utils/errorMessage';
import { debugLog } from '../utils/debugLog';
import { useT } from '../i18n/translate';

interface SpotifySetupProps {
  offline: boolean;
  signInError: string | null;
  onDetails: () => void;
}

export default function SpotifySetup({ offline, signInError, onDetails }: Readonly<SpotifySetupProps>) {
  const t = useT();
  const [connecting, setConnecting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const connect = async () => {
    setConnecting(true);
    setActionError(null);
    try {
      await startSignIn();
    } catch (caught) {
      const message = errorMessage(caught);
      setActionError(message);
      debugLog('error', 'sign-in', message);
    } finally {
      setConnecting(false);
    }
  };
  const error = actionError || signInError;
  return (
    <div className="spotify-setup">
      <h2>{t('setup.title')}</h2>
      {error && (
        <div>
          <p role="alert" className="text-danger">
            {error}
          </p>
          <button type="button" className="button button-secondary" onClick={onDetails}>
            {t('common.details')}
          </button>
        </div>
      )}
      {offline && <p>{t('setup.offline')}</p>}
      <button
        type="button"
        className="spotify-sign-in button"
        disabled={offline || connecting}
        onClick={() => void connect()}
      >
        {t(connecting ? 'setup.connecting' : 'setup.connect')}
      </button>
    </div>
  );
}
