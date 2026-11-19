import { useEffect, useState } from 'react';
import { readBluetoothReport, watchPresence } from '../utils/bluetoothMonitor';

/** How often the saved phones are re-read for a list of them. */
const POLL_MS = 30_000;
/** How often presence is re-read while the Pi listens: a phone is usually heard within a second or two. */
const WATCH_POLL_MS = 1000;
/** The Pi stops listening two minutes after it was asked (pi/kiosk-audio/presence.ts), so it is asked again before. */
const REWATCH_MS = 60_000;

export interface SavedPhone {
  address: string;
  name: string;
  isHere: boolean;
}

/**
 * The phones the Pi saved with "Pair my phone", re-read every 30 s while `enabled`
 * (and at once when `rereadKey` changes, as after a phone has paired).
 * Empty when the Pi cannot say (as off the kiosk, where there is no Pi).
 */
export function useSavedPhones(enabled: boolean, rereadKey = 0): SavedPhone[] {
  const [phones, setPhones] = useState<SavedPhone[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let isCurrent = true;
    const read = () => {
      readBluetoothReport()
        .then(report => {
          if (isCurrent) setPhones(report.phones);
        })
        .catch(() => {
          if (isCurrent) setPhones([]);
        });
    };
    read();
    const timer = setInterval(read, POLL_MS);
    return () => {
      isCurrent = false;
      clearInterval(timer);
    };
  }, [enabled, rereadKey]);
  return phones;
}

const UNHEARD: { phones: SavedPhone[]; isChecking: boolean } = { phones: [], isChecking: true };

/**
 * While `isWatching` (the person switcher is open), has the Pi listen for the saved phones (it does not otherwise) and
 * re-reads every second whether it hears each. `isChecking` is true while a phone not heard yet may still be heard.
 */
export function usePhonePresence(isWatching: boolean): { phones: SavedPhone[]; isChecking: boolean } {
  const [presence, setPresence] = useState(UNHEARD);
  useEffect(() => {
    if (!isWatching) return;
    let isCurrent = true;
    const watch = () =>
      watchPresence(true).catch(() => {
        // Off the kiosk there is no Pi; the read then says nobody is here.
      });
    const read = () => {
      readBluetoothReport()
        .then(report => {
          if (isCurrent) setPresence({ phones: report.phones, isChecking: report.presenceChecking });
        })
        .catch(() => {
          if (isCurrent) setPresence({ phones: [], isChecking: false });
        });
    };
    // Read once the Pi has started listening, so the first answer already says it is checking.
    void watch().then(read);
    const reading = setInterval(read, WATCH_POLL_MS);
    const rewatching = setInterval(() => void watch(), REWATCH_MS);
    return () => {
      isCurrent = false;
      clearInterval(reading);
      clearInterval(rewatching);
      // The next watch starts from nobody heard yet, not from what this one heard.
      setPresence(UNHEARD);
      watchPresence(false).catch(() => {
        // It stops by itself after two minutes.
      });
    };
  }, [isWatching]);
  return presence;
}

/** Bluetooth addresses compare without regard to case. */
export const samePhone = (a: string, b: string): boolean => a !== '' && a.toUpperCase() === b.toUpperCase();
