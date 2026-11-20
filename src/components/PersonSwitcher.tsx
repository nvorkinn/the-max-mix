import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { PEOPLE_LIMIT, peopleOnKiosk } from '../spotify/auth';
import { samePhone, usePhonePresence } from '../hooks/useSavedPhones';
import { useT } from '../i18n/translate';
import Modal from './Modal';
import PersonFace from './PersonFace';
import SongProof from './SongProof';

/**
 * The active person's picture (`children`) in the tab bar, as a button styled by `className`. Tapping it shows everyone's face, and tapping one switches to them
 * (`onSwitch`; the active person too, which starts their session again, so the check can be tried with one account). Someone whose linked phone the Pi does not hear is greyed out: tapping them shows a random song to play
 * on their phone instead (SongProof), and the switch follows once it plays on their account. The Pi listens for phones
 * only while the faces show, so for the first few seconds nobody is greyed out yet, and a tap on someone not heard yet
 * waits for the answer.
 */
/** How often a tap that waits for the Pi looks at its latest answer. */
const WAIT_STEP_MS = 200;

export default function PersonSwitcher({
  onSwitch,
  className,
  children
}: Readonly<{ onSwitch: (spotifyId: string) => void; className: string; children: ReactNode }>) {
  const t = useT();
  const [isOpen, setIsOpen] = useState(false);
  // Whose song is showing, or null for the faces.
  const [proving, setProving] = useState<string | null>(null);
  // Who was tapped while the Pi was still listening for their phone, or null.
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const { phones, isChecking } = usePhonePresence(isOpen);
  // The latest answer, for a tap that waits for it.
  const latestRef = useRef({ phones, isChecking });
  const waitingRef = useRef<string | null>(null);
  useEffect(() => {
    latestRef.current = { phones, isChecking };
  }, [phones, isChecking]);
  const people = peopleOnKiosk();
  const active = people.find(person => person.active);

  if (!active) return null;

  const isHere = (phoneAddress: string) => phones.some(phone => phone.isHere && samePhone(phoneAddress, phone.address));

  /** Switches once the Pi hears their phone, or shows the song when it has stopped checking without hearing it. */
  const waitForPhone = async (spotifyId: string, phoneAddress: string) => {
    waitingRef.current = spotifyId;
    setWaitingFor(spotifyId);
    const heard = () => latestRef.current.phones.some(phone => phone.isHere && samePhone(phoneAddress, phone.address));
    while (waitingRef.current === spotifyId && latestRef.current.isChecking && !heard()) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise(resolve => setTimeout(resolve, WAIT_STEP_MS));
    }
    // Closed, or someone else tapped, meanwhile.
    if (waitingRef.current !== spotifyId) return;
    waitingRef.current = null;
    setWaitingFor(null);
    if (heard()) {
      setIsOpen(false);
      onSwitch(spotifyId);
    } else {
      setProving(spotifyId);
    }
  };

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setIsOpen(true)}
        title={active.name}
        aria-label={t('person.switch_name', { name: active.name })}
      >
        {children}
      </button>
      {isOpen && (
        <Modal
          labelledBy="person-switcher-title"
          onClose={() => {
            setIsOpen(false);
            setProving(null);
            waitingRef.current = null;
            setWaitingFor(null);
          }}
          className="app-modal-panel person-sheet"
        >
          <h3 id="person-switcher-title" className="sr-only">
            {t('person.switch')}
          </h3>
          {proving ? (
            <SongProof
              spotifyId={proving}
              onProven={() => {
                setIsOpen(false);
                setProving(null);
                onSwitch(proving);
              }}
              onGiveUp={() => setProving(null)}
            />
          ) : (
            <ul className="person-sheet-faces">
              {people.slice(0, PEOPLE_LIMIT).map(person => {
                const isActive = person.active;
                // The active person goes through the same check, so the switch can be tried with only one account.
                const isHeard = isHere(person.phoneAddress);
                const isAway = !isChecking && !isHeard;
                return (
                  <li key={person.spotifyId}>
                    <button
                      type="button"
                      className="person-choice"
                      aria-pressed={isActive}
                      data-away={isAway || undefined}
                      aria-busy={waitingFor === person.spotifyId || undefined}
                      {...(isActive && { 'data-modal-autofocus': true })}
                      onClick={() => {
                        if (!isHeard) {
                          if (isChecking) void waitForPhone(person.spotifyId, person.phoneAddress);
                          else setProving(person.spotifyId);
                          return;
                        }
                        setIsOpen(false);
                        onSwitch(person.spotifyId);
                      }}
                    >
                      <PersonFace name={person.name} imageUrl={person.imageUrl} className="person-face-choice" />
                      <span className="person-choice-name">{person.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Modal>
      )}
    </>
  );
}
