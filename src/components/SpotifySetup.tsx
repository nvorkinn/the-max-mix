import { useState } from 'react';
import { Music } from 'lucide-react';
import { startSignIn } from '../spotify/auth';
import { reloadSettings, setDemoMode } from '../spotify/settings';
import { errorMessage } from '../utils/errorMessage';
import { debugLog } from '../utils/debugLog';

interface SpotifySetupProps {
  offline: boolean;
  signInError: string | null;
  onSettings: () => void;
  onDetails: () => void;
}

export default function SpotifySetup({ offline, signInError, onSettings, onDetails }: Readonly<SpotifySetupProps>) {
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
      <Music size={32} className="text-accent" aria-hidden="true" />
      <h2>Bring your music to the tablet</h2>
      <p>
        Connect your Spotify Premium account, then choose where to play. Opening this app won't move or start your
        music.
      </p>
      {error && (
        <div>
          <p role="alert" className="text-danger">
            {error}
          </p>
          <button type="button" className="button button-secondary" onClick={onDetails}>
            Details
          </button>
        </div>
      )}
      {offline && <p>Reconnect to the network to sign in or reload into demo mode.</p>}
      <button
        type="button"
        className="spotify-sign-in button"
        disabled={offline || connecting}
        onClick={() => void connect()}
      >
        {connecting ? 'Connecting...' : 'Connect Spotify'}
      </button>
      <div>
        <button
          type="button"
          className="button button-secondary"
          disabled={offline || connecting}
          onClick={() => {
            setDemoMode(true);
            reloadSettings();
          }}
        >
          Try demo
        </button>
        <p>Simulated playback and queue. No account needed. Reloads the app.</p>
      </div>
      <button type="button" className="button button-secondary" onClick={onSettings}>
        Connection settings
      </button>
    </div>
  );
}
