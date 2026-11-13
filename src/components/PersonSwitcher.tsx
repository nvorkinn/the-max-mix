import { useState } from 'react';
import { PEOPLE_LIMIT, peopleOnKiosk } from '../spotify/auth';
import { samePhone, useSavedPhones } from '../hooks/useSavedPhones';
import Modal from './Modal';
import PersonFace from './PersonFace';

/**
 * The active person's picture in the banner. Tapping it shows everyone's face; only those whose linked phone the Pi
 * hears can be picked (the others are greyed out), and tapping one switches to them (`onSwitch`).
 */
export default function PersonSwitcher({ onSwitch }: Readonly<{ onSwitch: (spotifyId: string) => void }>) {
  const [isOpen, setIsOpen] = useState(false);
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
          onClose={() => setIsOpen(false)}
          className="app-modal-panel person-sheet"
        >
          <h3 id="person-switcher-title" className="sr-only">
            Switch person
          </h3>
          <ul className="person-sheet-faces">
            {people.slice(0, PEOPLE_LIMIT).map(person => {
              const isActive = person.active;
              return (
                <li key={person.spotifyId}>
                  <button
                    type="button"
                    className="person-choice"
                    aria-pressed={isActive}
                    disabled={!isActive && !isHere(person.phoneAddress)}
                    {...(isActive && { 'data-modal-autofocus': true })}
                    onClick={() => {
                      setIsOpen(false);
                      if (!isActive) onSwitch(person.spotifyId);
                    }}
                  >
                    <PersonFace name={person.name} imageUrl={person.imageUrl} className="person-face-choice" />
                    <span className="person-choice-name">{person.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Modal>
      )}
    </>
  );
}
