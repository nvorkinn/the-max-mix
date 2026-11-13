import { useEffect, useState } from 'react';
import { readBluetoothReport } from '../utils/bluetoothMonitor';

/** The Pi checks for the saved phones every 30 s (pi/kiosk-audio/presence.ts), so reading more often shows nothing new. */
const POLL_MS = 30_000;

export interface SavedPhone {
  address: string;
  name: string;
  isHere: boolean;
}

/**
 * The phones the Pi saved with "Pair my phone", and whether it hears each one, re-read every 30 s while `enabled`.
 * Empty when the Pi cannot say (as off the kiosk, where there is no Pi).
 */
export function useSavedPhones(enabled: boolean): SavedPhone[] {
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
  }, [enabled]);
  return phones;
}

/** Bluetooth addresses compare without regard to case. */
export const samePhone = (a: string, b: string): boolean => a !== '' && a.toUpperCase() === b.toUpperCase();
