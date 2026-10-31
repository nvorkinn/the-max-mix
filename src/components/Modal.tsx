import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';

function keepFocusInDialog(event: KeyboardEvent) {
  if (event.key !== 'Tab') return;
  const dialog = event.currentTarget;
  if (!(dialog instanceof HTMLDialogElement)) return;
  const controls = [...dialog.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]')]
    .filter(element => element.tabIndex >= 0 && !element.matches(':disabled'))
    .filter(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
  const first = controls[0];
  const last = controls.at(-1);
  const active = document.activeElement;
  if (!first || !last) {
    event.preventDefault();
    dialog.focus();
  } else if (active === dialog || active === (event.shiftKey ? first : last) || !dialog.contains(active)) {
    // Native dialogs otherwise let boundary tabs move into the browser chrome.
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

export default function Modal({
  labelledBy,
  onClose,
  className,
  children
}: Readonly<{ labelledBy: string; onClose: () => void; className: string; children: ReactNode }>) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    // Close before React removes the element so native modal cleanup runs while it is connected.
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-modal-autofocus]')?.focus();
    dialog.addEventListener('keydown', keepFocusInDialog);
    return () => {
      dialog.removeEventListener('keydown', keepFocusInDialog);
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby={labelledBy}
      className={`app-dialog ${className}`}
      onCancel={event => {
        event.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}
