import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Plus, Trash2, UserRound, XCircle } from 'lucide-react';
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
import { forgetSoloistKey } from '../../countdown/soloistKeys';
import { errorMessage } from '../../utils/errorMessage';
import { forgetSignIns, isKiosk } from '../../utils/kiosk';
import ConfirmButton from '../ConfirmButton';
import PhonePicker from '../PhonePicker';
import { forgetUnlinkedPhone } from '../../utils/phoneLinks';
import SpotifyIcon from '../SpotifyIcon';
import { useT } from '../../i18n/translate';
import type { StringId } from '../../i18n/strings';
import type { LyricsStyle } from '../../utils/lyricsStyle';
import LyricsSettings from './LyricsSettings';
import SettingsSection from './SettingsSection';
import SoloistKeyButton from './SoloistKeyButton';

type ShownStatus = Exclude<PersonStatus, 'unknown'>;

const STATUS: Record<ShownStatus, { text: StringId; className: string; Icon: typeof CheckCircle2 }> = {
  connected: { text: 'spotify.connected', className: 'status-success', Icon: CheckCircle2 },
  expired: { text: 'spotify.expired', className: 'status-warning', Icon: AlertCircle },
  refused: { text: 'spotify.refused', className: 'status-danger', Icon: XCircle }
};

/** What a person's row shows until Spotify answers (or when it cannot be asked): what this kiosk knows of their login. */
const knownStatus = (person: PersonOnKiosk): ShownStatus => (person.signedIn ? 'connected' : 'expired');

/** A person's picture, or a figure where they have none. */
function Face({ person }: Readonly<{ person: PersonOnKiosk }>) {
  return person.imageUrl ? (
    <img className="person-face-picture" src={person.imageUrl} alt="" />
  ) : (
    <span className="person-face-picture person-face-blank">
      <UserRound className="w-7 h-7" aria-hidden="true" />
    </span>
  );
}

/**
 * The Spotify page. Everyone signed in on this kiosk as a row of faces, each with a dot for whether their login works
 * (asked of Spotify when the page opens) and a mark on the one playing; then the chosen face's login, phone, Soloist
 * key and removal; then adding a person, or the first sign-in when nobody is signed in. Under them, how synced lyrics
 * look, shown on a few lines as they will play. `onLyricsChange` saves that where the kiosk keeps it.
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
  const t = useT();
  const [actionError, setActionError] = useState<string | null>(null);
  const [people, setPeople] = useState(peopleOnKiosk);
  const [statuses, setStatuses] = useState<Record<string, PersonStatus>>({});
  const [chosenId, setChosenId] = useState<string | undefined>();
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

  const statusOf = (person: PersonOnKiosk): ShownStatus => {
    const checked = statuses[person.spotifyId];
    return checked && checked !== 'unknown' ? checked : knownStatus(person);
  };
  // The face tapped last, or else the one playing, so a kiosk with one person shows theirs straight away.
  const chosen =
    people.find(person => person.spotifyId === chosenId) ?? people.find(person => person.active) ?? people[0];

  return (
    <div className="settings-stack">
      {error && (
        <p role="alert" className="settings-error status-danger">
          {error}
        </p>
      )}

      {signInError && !isPersonRefused(signInError) && (
        <p className="text-muted break-words">
          {t('spotify.redirect')} <code className="text-accent break-all">{getRedirectUri()}</code>
        </p>
      )}

      {chosen ? (
        <SettingsSection id="spotify-people-label" title={t('spotify.people')}>
          <ul className="person-faces" aria-label={t('spotify.people')}>
            {people.map(person => {
              const name = person.name || t('spotify.account');
              const shown = STATUS[statusOf(person)];
              return (
                <li key={person.spotifyId} aria-current={person.active ? 'true' : undefined}>
                  <button
                    type="button"
                    className="person-face"
                    aria-pressed={person.spotifyId === chosen.spotifyId}
                    onClick={() => setChosenId(person.spotifyId)}
                  >
                    <span className="person-face-ring">
                      <Face person={person} />
                      <span className={`person-face-dot ${shown.className}`} aria-hidden="true" />
                      {person.active && (
                        <CheckCircle2 className="person-face-active" aria-label={t('spotify.active')} />
                      )}
                    </span>
                    <span className="person-face-name">{name}</span>
                  </button>
                </li>
              );
            })}
            <li>
              <button
                type="button"
                disabled={people.length >= PEOPLE_LIMIT}
                onClick={() => leave(() => forgetSignIns().then(startAddPerson))}
                className="person-face"
                aria-label={t('spotify.add_person')}
              >
                <span className="person-face-ring person-face-add" aria-hidden="true">
                  <Plus className="w-7 h-7" />
                </span>
                <span className="person-face-name text-muted" aria-hidden="true">
                  {t('spotify.add')}
                </span>
              </button>
            </li>
          </ul>
          <PersonDetail
            key={chosen.spotifyId}
            person={chosen}
            status={statusOf(chosen)}
            onSignIn={() => leave(() => forgetSignIns().then(() => startSignIn(chosen.spotifyId)))}
            onPhoneChange={() => setPeople(peopleOnKiosk())}
            onRemove={() => {
              const outcome = removePerson(chosen.spotifyId);
              forgetUnlinkedPhone(chosen.phoneAddress);
              forgetSoloistKey(chosen.spotifyId);
              setChosenId(undefined);
              if (outcome === 'kept') setPeople(peopleOnKiosk());
              else if (outcome === 'switched') onReload();
              else void forgetSignIns().then(() => onReload());
            }}
          />
        </SettingsSection>
      ) : (
        <button
          type="button"
          onClick={() => leave(() => startSignIn())}
          className="spotify-sign-in settings-wide-button font-extrabold rounded-xl flex items-center justify-center gap-2 active:scale-98 transition-all"
        >
          <SpotifyIcon className="w-5 h-5" />
          {t('spotify.log_in')}
        </button>
      )}

      <LyricsSettings onChange={onLyricsChange} />
    </div>
  );
}

/**
 * The chosen person: their name and whether their login works, signing in again when it does not, their phone, saving
 * their Soloist key while they have none, and removing them.
 */
function PersonDetail({
  person,
  status,
  onSignIn,
  onPhoneChange,
  onRemove
}: Readonly<{
  person: PersonOnKiosk;
  status: ShownStatus;
  onSignIn: () => void;
  onPhoneChange: () => void;
  onRemove: () => void;
}>) {
  const t = useT();
  const name = person.name || t('spotify.account');
  const shown = STATUS[status];
  return (
    <div className="person-detail" role="group" aria-label={name}>
      <span className="person-detail-about">
        <span className="person-detail-name truncate">{name}</span>
        <span className={`settings-person-status modal-status ${shown.className}`}>
          <shown.Icon className="w-4 h-4" aria-hidden="true" />
          {t(shown.text)}
        </span>
      </span>
      {status !== 'connected' && (
        <button type="button" onClick={onSignIn} className="spotify-sign-in settings-person-sign-in">
          <SpotifyIcon className="w-5 h-5" />
          {t('spotify.sign_in')}
        </button>
      )}
      {isKiosk() && (
        <PhonePicker
          spotifyId={person.spotifyId}
          name={name}
          imageUrl={person.imageUrl}
          phoneAddress={person.phoneAddress}
          onChange={onPhoneChange}
        />
      )}
      <SoloistKeyButton spotifyId={person.spotifyId} name={name} />
      <ConfirmButton
        label={t('spotify.remove')}
        confirmLabel={t('spotify.remove_confirm')}
        className="shrink-0"
        icon={<Trash2 className="w-5 h-5 shrink-0" aria-hidden="true" />}
        onConfirm={onRemove}
      />
    </div>
  );
}
