import { useState } from 'react';
import { Bluetooth, Smartphone } from 'lucide-react';
import { samePhone, useSavedPhones } from '../hooks/useSavedPhones';
import { setPersonPhone } from '../utils/phoneLinks';
import { useT } from '../i18n/translate';
import Modal from './Modal';
import PairPhoneSheet from './PairPhoneSheet';

/**
 * Which of the Pi's saved phones belongs to a person, so the banner's switcher offers them only while the Pi hears it.
 * Shows the linked phone's name; tapping it offers to pair a new phone (which is then linked) or lists the saved phones,
 * and None.
 */
export default function PhonePicker({
  spotifyId,
  name,
  imageUrl = '',
  phoneAddress,
  onChange
}: Readonly<{ spotifyId: string; name: string; imageUrl?: string; phoneAddress: string; onChange: () => void }>) {
  const t = useT();
  const [isOpen, setIsOpen] = useState(false);
  const [isPairing, setIsPairing] = useState(false);
  const [pairings, setPairings] = useState(0);
  // Read always, not just while open, so the button can name the linked phone; again once a new one has paired.
  const phones = useSavedPhones(true, pairings);
  const linked = phones.find(phone => samePhone(phoneAddress, phone.address));
  const choose = (address: string) => {
    setIsOpen(false);
    setPersonPhone(spotifyId, address);
    onChange();
  };
  const label = linked ? linked.name || linked.address : phoneAddress || t('phone.none');
  const titleId = `phone-picker-title-${spotifyId}`;

  return (
    <>
      <button
        type="button"
        className="button button-secondary phone-picker-button"
        onClick={() => setIsOpen(true)}
        aria-label={t('phone.of', { name })}
      >
        <Smartphone className="w-5 h-5" aria-hidden="true" />
        <span>{label}</span>
      </button>
      {isOpen && (
        <Modal labelledBy={titleId} onClose={() => setIsOpen(false)} className="app-modal-panel phone-picker-sheet">
          <h3 id={titleId} className="phone-picker-title">
            {t('phone.of', { name })}
          </h3>
          <ul className="phone-picker-options">
            <li>
              <button
                type="button"
                className="modal-option phone-picker-option phone-picker-pair"
                onClick={() => {
                  setIsOpen(false);
                  setIsPairing(true);
                }}
              >
                <Bluetooth className="w-5 h-5" aria-hidden="true" />
                {t('phone.pair_new')}
              </button>
            </li>
            {phones.map(phone => (
              <li key={phone.address}>
                <button
                  type="button"
                  className="modal-option phone-picker-option"
                  aria-pressed={samePhone(phoneAddress, phone.address)}
                  onClick={() => choose(phone.address)}
                >
                  {phone.name || phone.address}
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                className="modal-option phone-picker-option"
                aria-pressed={phoneAddress === ''}
                onClick={() => choose('')}
              >
                {t('phone.none')}
              </button>
            </li>
          </ul>
        </Modal>
      )}
      {isPairing && (
        <PairPhoneSheet
          spotifyId={spotifyId}
          name={name}
          imageUrl={imageUrl}
          onDone={() => {
            setIsPairing(false);
            setPairings(count => count + 1);
            onChange();
          }}
        />
      )}
    </>
  );
}
