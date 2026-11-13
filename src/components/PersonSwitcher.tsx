import { useState } from 'react';
import { PEOPLE_LIMIT, peopleOnKiosk } from '../spotify/auth';
import { samePhone, useSavedPhones } from '../hooks/useSavedPhones';
import Modal from './Modal';
import PersonFace from './PersonFace';
import SongProof from './SongProof';

/**
 * The active person's picture in the banner. Tapping it shows everyone's face, and tapping one switches to them
 * (`onSwitch`; the active person too, which starts their session again, so the check can be tried with one account). Someone whose linked phone the Pi does not hear is greyed out: tapping them shows a random song to play
 * on their phone instead (SongProof), and the switch follows once it plays on their account.
 */
export default function PersonSwitcher({ onSwitch }: Readonly<{ onSwitch: (spotifyId: string) => void }>) {
  const [isOpen, setIsOpen] = useState(false);
  // Whose song is showing, or null for the faces.
  const [proving, setProving] = useState<string | null>(null);
  const phones = useSavedPhones(isOpen);
  const people = peopleOnKiosk();
  const active = people.find(person => person.active);
  if (!active) return null;

  const isHere = (phoneAddress: string) => phones.some(phone => phone.isHere && samePhone(phoneAddress, phone.address));

  return (
    <>
      <button
        type="button"
        className="icon-button person-button"
        onClick={() => setIsOpen(true)}
        title={active.name}
        aria-label={`${active.name}: switch person`}
      >
        <PersonFace name={active.name} imageUrl={active.imageUrl} className="person-face-banner" />
      </button>
      {isOpen && (
        <Modal
          labelledBy="person-switcher-title"
          onClose={() => {
            setIsOpen(false);
            setProving(null);
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
                const isAway = !isHere(person.phoneAddress);
                return (
                  <li key={person.spotifyId}>
                    <button
                      type="button"
                      className="person-choice"
                      aria-pressed={isActive}
                      data-away={isAway || undefined}
                      {...(isActive && { 'data-modal-autofocus': true })}
                      onClick={() => {
                        if (isAway) {
                          setProving(person.spotifyId);
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
