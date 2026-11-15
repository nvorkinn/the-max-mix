import { useEffect } from 'react';
import type { RefObject } from 'react';
import { isKiosk } from '../utils/kiosk';

/**
 * Focuses a text field in a dialog and, on the kiosk, shows the on-screen keyboard for it. The touch screen has no
 * keyboard of its own, and a modal dialog makes the rest of the page untouchable, so the keyboard goes inside the dialog.
 * Loaded only on the kiosk.
 */
export function useOnScreenKeyboard(fieldRef: RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    const field = fieldRef.current;
    field?.focus();
    const dialog = field?.closest('dialog');
    if (!dialog || !isKiosk()) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import('../../pi/kiosk-keyboard/keyboard').then(keyboard => {
      if (!cancelled) stop = keyboard.start(document, dialog);
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [fieldRef]);
}
