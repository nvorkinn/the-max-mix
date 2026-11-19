import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { PEOPLE_LIMIT, peopleOnKiosk } from '../spotify/auth';
import { samePhone, usePhonePresence } from '../hooks/useSavedPhones';
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
  const [isOpen, setIsOpen] = useState(false);
  // Whose song is showing, or null for the faces.
  const [proving, setProving] = useState<string | null>(null);
  // Who was tapped while the Pi was still listening for their phone, or null.
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const { phones, checking } = usePhonePresence(isOpen);
  const people = peopleOnKiosk();
  const active = people.find(person => person.active);
  const isHere = (phoneAddress: string) => phones.some(phone => phone.isHere && samePhone(phoneAddress, phone.address));
  // The latest answer, for a tap that waits for it.
  const latest = useRef({ phones, checking });
  const waiting = useRef<string | null>(null);
  useEffect(() => {
    latest.current = { phones, checking };
  }, [phones, checking]);

  /** Switches once the Pi hears their phone, or shows the song when it has stopped checking without hearing it. */
  const waitForPhone = async (spotifyId: string, phoneAddress: string) => {
    waiting.current = spotifyId;
    setWaitingFor(spotifyId);
    const heard = () => latest.current.phones.some(phone => phone.isHere && samePhone(phoneAddress, phone.address));
    while (waiting.current === spotifyId && latest.current.checking && !heard()) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise(resolve => setTimeout(resolve, WAIT_STEP_MS));
    }
    // Closed, or someone else tapped, meanwhile.
    if (waiting.current !== spotifyId) return;
    waiting.current = null;
    setWaitingFor(null);
    if (heard()) {
      setIsOpen(false);
      onSwitch(spotifyId);
    } else {
      setProving(spotifyId);
    }
  };

  if (!active) return null;

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setIsOpen(true)}
        title={active.name}
        aria-label={`${active.name}: switch person`}
      >
        {children}
      </button>
      {isOpen && (
        <Modal
          labelledBy="person-switcher-title"
          onClose={() => {
            setIsOpen(false);
            setProving(null);
            waiting.current = null;
            setWaitingFor(null);
          }}
          className="app-modal-panel person-sheet"
        >
          <h3 id="person-switcher-title" className="sr-only">
            Switch person
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
                const isAway = !checking && !isHeard;
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
                          if (checking) void waitForPhone(person.spotifyId, person.phoneAddress);
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
