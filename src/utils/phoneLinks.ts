import { linkPhone, peopleOnKiosk } from '../spotify/auth';
import { samePhone } from '../hooks/useSavedPhones';
import { forgetPhone } from './bluetoothMonitor';

/**
 * Has the Pi unpair and forget a phone once nobody on the kiosk links it any more. The Pi only lists phones it has not
 * paired, so one left paired could never be picked in "Pair new phone" again.
 */
export function forgetUnlinkedPhone(address: string): void {
  if (!address || peopleOnKiosk().some(person => samePhone(person.phoneAddress, address))) return;
  forgetPhone(address).catch((error: unknown) => console.warn(`Could not forget the phone ${address}:`, error));
}

/** Links a phone (or none, with '') to a person, and has the Pi forget the one it replaces if nobody else links it. */
export function setPersonPhone(spotifyId: string, address: string): void {
  const previous = peopleOnKiosk().find(person => person.spotifyId === spotifyId)?.phoneAddress ?? '';
  linkPhone(spotifyId, address);
  if (!samePhone(previous, address)) forgetUnlinkedPhone(previous);
}
