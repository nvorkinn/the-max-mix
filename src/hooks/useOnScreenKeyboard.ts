import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { KeyboardOptions } from '../../pi/kiosk-keyboard/keyboard';
import { isKiosk } from '../utils/kiosk';

export interface OnScreenKeyboardOptions extends KeyboardOptions {
  /** Focus the field when the dialog opens, which brings the keyboard up at once; otherwise it comes with a tap. */
  focus?: boolean;
}

/**
 * Focuses a text field in a dialog (unless asked not to) and, on the kiosk, shows the on-screen keyboard while it has
 * focus. The touch screen has no keyboard of its own, and a modal dialog makes the rest of the page untouchable, so the
 * keyboard goes inside the dialog. Loaded only on the kiosk.
 */
export function useOnScreenKeyboard(
  fieldRef: RefObject<HTMLInputElement | null>,
  { focus = true, hasNumberRow = false, isUppercase = false }: OnScreenKeyboardOptions = {}
): void {
  useEffect(() => {
    const field = fieldRef.current;
    if (focus) field?.focus();
    const dialog = field?.closest('dialog');
    if (!dialog || !isKiosk()) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import('../../pi/kiosk-keyboard/keyboard').then(keyboard => {
      if (!cancelled) stop = keyboard.start(document, dialog, { hasNumberRow, isUppercase });
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [fieldRef, focus, hasNumberRow, isUppercase]);
}
