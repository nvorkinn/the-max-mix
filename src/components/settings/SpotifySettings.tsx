import { useState } from 'react';
import { AlertCircle, CheckCircle2, LogOut, Music, Trash2, UserPlus, UserRound } from 'lucide-react';
import {
  isPersonRefused,
  PEOPLE_LIMIT,
  peopleOnKiosk,
  removePerson,
  signOut,
  startAddPerson,
  startSignIn
} from '../../spotify/auth';
import { getRedirectUri } from '../../spotify/settings';
import { errorMessage } from '../../utils/errorMessage';
import { forgetSignIns } from '../../utils/kiosk';
import ConfirmButton from '../ConfirmButton';

/**
 * Spotify's sign-in: whether this app is connected, everyone signed in on this kiosk (each removable), and the buttons
 * that add a person, sign in again or sign everyone out.
 */
export default function SpotifySettings({
  authenticated,
  signInError,
  onReload
}: Readonly<{ authenticated: boolean; signInError: string | null; onReload: () => void }>) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [people, setPeople] = useState(peopleOnKiosk);
  const error = actionError || signInError;
  const leave = (start: () => Promise<void>) => {
    setActionError(null);
    start().catch((caught: unknown) => setActionError(errorMessage(caught)));
  };

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

      {signInError && !isPersonRefused(signInError) && (
        <p className="text-muted break-words">
          Register this exact redirect address in your Spotify app settings:{' '}
          <code className="text-accent break-all">{getRedirectUri()}</code>
        </p>
      )}

      {authenticated && people.length > 0 && (
        <ul className="settings-people" aria-label="People">
          {people.map(person => (
            <li
              key={person.spotifyId}
              className="settings-person settings-box"
              aria-current={person.active ? 'true' : undefined}
            >
              {person.imageUrl ? (
                <img className="settings-person-picture" src={person.imageUrl} alt="" />
              ) : (
                <span className="settings-person-picture settings-box-icon">
                  <UserRound className="w-6 h-6" aria-hidden="true" />
                </span>
              )}
              <span className="settings-box-title min-w-0 flex-1 truncate">{person.name || 'Spotify account'}</span>
              {person.active && <CheckCircle2 className="settings-person-active w-6 h-6" aria-label="Active" />}
              <ConfirmButton
                label="Remove"
                confirmLabel="Tap again to remove"
                className="shrink-0"
                icon={<Trash2 className="w-5 h-5 shrink-0" aria-hidden="true" />}
                onConfirm={() => {
                  const outcome = removePerson(person.spotifyId);
                  if (outcome === 'kept') setPeople(peopleOnKiosk());
                  else if (outcome === 'switched') onReload();
                  else void forgetSignIns().then(() => onReload());
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {authenticated && (
        <button
          type="button"
          disabled={people.length >= PEOPLE_LIMIT}
          onClick={() => leave(() => forgetSignIns().then(startAddPerson))}
          className="button button-secondary settings-wide-button"
        >
          <UserPlus className="w-5 h-5" aria-hidden="true" />
          Add person
        </button>
      )}

      <button
        type="button"
        onClick={() => leave(startSignIn)}
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
