import { useState } from 'react';
import { AlertCircle, CheckCircle2, LogOut, Music } from 'lucide-react';
import { signOut, startSignIn } from '../../spotify/auth';
import { getRedirectUri } from '../../spotify/settings';
import { errorMessage } from '../../utils/errorMessage';
import { forgetSignIns } from '../../utils/kiosk';

/** Spotify's sign-in: whether this app is connected, and the buttons that sign in again or out. */
export default function SpotifySettings({
  authenticated,
  signInError,
  onReload
}: Readonly<{ authenticated: boolean; signInError: string | null; onReload: () => void }>) {
  const [actionError, setActionError] = useState<string | null>(null);
  const error = actionError || signInError;

  return (
    <div className="settings-stack">
      <div className="settings-box flex items-center gap-4">
        <span className="settings-box-icon">
          <Music className="w-6 h-6" aria-hidden="true" />
        </span>
        <div className="settings-box-title min-w-0 flex-1">Spotify account</div>
        {authenticated ? (
          <span className="modal-status status-success flex items-center font-bold gap-1.5 px-3 py-1 rounded-full border">
            <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Connected
          </span>
        ) : (
          <span className="modal-status status-warning flex items-center font-bold gap-1.5 px-3 py-1 rounded-full border">
            <AlertCircle className="w-4 h-4" aria-hidden="true" /> Not connected
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="settings-error status-danger">
          {error}
        </p>
      )}

      {signInError && (
        <p className="text-muted break-words">
          Register this exact redirect address in your Spotify app settings:{' '}
          <code className="text-accent break-all">{getRedirectUri()}</code>
        </p>
      )}

      <button
        type="button"
        onClick={() => {
          setActionError(null);
          startSignIn().catch((caught: unknown) => setActionError(errorMessage(caught)));
        }}
        className="spotify-sign-in settings-wide-button font-extrabold rounded-xl flex items-center justify-center gap-2 active:scale-98 transition-all"
      >
        <Music className="w-5 h-5 fill-current" aria-hidden="true" />
        {authenticated ? 'Re-authenticate with Spotify' : 'Log in with Spotify'}
      </button>

      {authenticated && (
        <button
          type="button"
          onClick={() => {
            signOut();
            void forgetSignIns().then(() => onReload());
          }}
          className="button button-secondary settings-wide-button"
        >
          <LogOut className="w-5 h-5" aria-hidden="true" />
          Sign out
        </button>
      )}
    </div>
  );
}
