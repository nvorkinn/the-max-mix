import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Trash2, UserPlus, UserRound, XCircle } from 'lucide-react';
import {
  checkPerson,
  isPersonRefused,
  PEOPLE_LIMIT,
  peopleOnKiosk,
  type PersonOnKiosk,
  type PersonStatus,
  removePerson,
  startAddPerson,
  startSignIn
} from '../../spotify/auth';
import { getRedirectUri } from '../../spotify/settings';
import { errorMessage } from '../../utils/errorMessage';
import { forgetSignIns, isKiosk } from '../../utils/kiosk';
import ConfirmButton from '../ConfirmButton';
import PhonePicker from '../PhonePicker';
import { forgetUnlinkedPhone } from '../../utils/phoneLinks';
import SpotifyIcon from '../SpotifyIcon';
import type { LyricsStyle } from '../../utils/lyricsStyle';
import LyricsSettings from './LyricsSettings';

type ShownStatus = Exclude<PersonStatus, 'unknown'>;

const STATUS: Record<ShownStatus, { text: string; className: string; Icon: typeof CheckCircle2 }> = {
  connected: { text: 'Connected', className: 'status-success', Icon: CheckCircle2 },
  expired: { text: 'Expired', className: 'status-warning', Icon: AlertCircle },
  refused: { text: 'Not allowed', className: 'status-danger', Icon: XCircle }
};

/** What a person's row shows until Spotify answers (or when it cannot be asked): what this kiosk knows of their login. */
const knownStatus = (person: PersonOnKiosk): ShownStatus => (person.signedIn ? 'connected' : 'expired');

/**
 * Everyone signed in to Spotify on this kiosk, one row each: whether their login works (asked of Spotify when the page
 * opens), signing them in again when it does not, their phone and removing them. Then adding a person, or the first
 * sign-in when nobody is signed in, and how the synced lyrics look.
 */
export default function SpotifySettings({
  signInError,
  onReload,
  onLyricsChange
}: Readonly<{
  signInError: string | null;
  onReload: () => void;
  onLyricsChange?: ((style: LyricsStyle) => void) | undefined;
}>) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [people, setPeople] = useState(peopleOnKiosk);
  const [statuses, setStatuses] = useState<Record<string, PersonStatus>>({});
  const error = actionError || signInError;
  const leave = (start: () => Promise<void>) => {
    setActionError(null);
    start().catch((caught: unknown) => setActionError(errorMessage(caught)));
  };

  useEffect(() => {
    let current = true;
    for (const { spotifyId } of peopleOnKiosk()) {
      void checkPerson(spotifyId).then(status => {
        if (!current) return;
        setStatuses(known => ({ ...known, [spotifyId]: status }));
        // A check that found the login revoked has marked them signed out.
        setPeople(peopleOnKiosk());
      });
    }
    return () => {
      current = false;
    };
  }, []);

  return (
    <div className="settings-stack">
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

      {people.length > 0 ? (
        <>
          <ul className="settings-people" aria-label="People">
            {people.map(person => {
              const name = person.name || 'Spotify account';
              const checked = statuses[person.spotifyId];
              const status = checked && checked !== 'unknown' ? checked : knownStatus(person);
              const shown = STATUS[status];
              return (
                <li
                  key={person.spotifyId}
                  className="settings-person settings-box"
                  aria-current={person.active ? 'true' : undefined}
                >
                  <span className="settings-person-face">
                    {person.imageUrl ? (
                      <img className="settings-person-picture" src={person.imageUrl} alt="" />
                    ) : (
                      <span className="settings-person-picture settings-box-icon">
                        <UserRound className="w-6 h-6" aria-hidden="true" />
                      </span>
                    )}
                    {person.active && <CheckCircle2 className="settings-person-active" aria-label="Active" />}
                  </span>
                  <span className="settings-person-about">
                    <span className="settings-box-title truncate">{name}</span>
                    <span className={`settings-person-status modal-status ${shown.className}`}>
                      <shown.Icon className="w-4 h-4" aria-hidden="true" />
                      {shown.text}
                    </span>
                  </span>
                  {status !== 'connected' && (
                    <button
                      type="button"
                      onClick={() => leave(() => forgetSignIns().then(() => startSignIn(person.spotifyId)))}
                      className="spotify-sign-in settings-person-sign-in"
                    >
                      <SpotifyIcon className="w-5 h-5" />
                      Sign in
                    </button>
                  )}
                  {isKiosk() && (
                    <PhonePicker
                      spotifyId={person.spotifyId}
                      name={name}
                      phoneAddress={person.phoneAddress}
                      onChange={() => setPeople(peopleOnKiosk())}
                    />
                  )}
                  <ConfirmButton
                    label="Remove"
                    confirmLabel="Tap again to remove"
                    className="shrink-0"
                    icon={<Trash2 className="w-5 h-5 shrink-0" aria-hidden="true" />}
                    onConfirm={() => {
                      const outcome = removePerson(person.spotifyId);
                      forgetUnlinkedPhone(person.phoneAddress);
                      if (outcome === 'kept') setPeople(peopleOnKiosk());
                      else if (outcome === 'switched') onReload();
                      else void forgetSignIns().then(() => onReload());
                    }}
                  />
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            disabled={people.length >= PEOPLE_LIMIT}
            onClick={() => leave(() => forgetSignIns().then(startAddPerson))}
            className="button button-secondary settings-wide-button"
          >
            <UserPlus className="w-5 h-5" aria-hidden="true" />
            Add person
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => leave(() => startSignIn())}
          className="spotify-sign-in settings-wide-button font-extrabold rounded-xl flex items-center justify-center gap-2 active:scale-98 transition-all"
        >
          <SpotifyIcon className="w-5 h-5" />
          Log in with Spotify
        </button>
      )}

      <LyricsSettings onChange={onLyricsChange} />
    </div>
  );
}
