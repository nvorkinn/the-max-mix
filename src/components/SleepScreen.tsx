import { useLayoutEffect, useRef } from 'react';

/**
 * The kiosk's black sleep screen (hooks/useScreenSleep). It covers everything, so the tap that wakes the screen lands
 * here and never presses a button behind it. Black also keeps the panel dark if the Pi could not turn its output off.
 * It is a modal dialog of its own: an open dialog (Settings, say) sits in the browser's top layer, above any z-index, and
 * would otherwise hide the sleep screen until it closed. Opened last, this one goes on top of it.
 */
export default function SleepScreen({ onWake }: Readonly<{ onWake: () => void }>) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="sleep-screen"
      aria-label="Sleep screen"
      onCancel={event => {
        // Escape wakes the screen (useScreenSleep) rather than closing the dialog behind React's back.
        event.preventDefault();
      }}
    >
      <button
        type="button"
        className="sleep-screen-button"
        aria-label="Wake the screen"
        onPointerDown={event => event.preventDefault()}
        onClick={event => {
          event.stopPropagation();
          onWake();
        }}
      />
    </dialog>
  );
}
