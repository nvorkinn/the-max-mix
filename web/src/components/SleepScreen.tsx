import { useLayoutEffect, useRef } from 'react';
import { useT } from '../i18n/translate';

/**
 * The kiosk's black sleep screen (hooks/useScreenSleep), or while `dimmed` a half-black layer over the page, for a panel
 * with no brightness control. On a `backlit` panel the backlight is turned down instead (utils/backlight), so the layer
 * is clear. It covers everything, so the tap that wakes the screen lands here and never presses a button
 * behind it. Black also keeps the panel dark if the Pi could not turn its output off.
 * It is a modal dialog of its own: an open dialog (Settings, say) sits in the browser's top layer, above any z-index, and
 * would otherwise hide the sleep screen until it closed. Opened last, this one goes on top of it.
 */
export default function SleepScreen({
  dimmed = false,
  backlit = false,
  onWake
}: Readonly<{ dimmed?: boolean; backlit?: boolean; onWake: () => void }>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const t = useT();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  let className = 'sleep-screen';
  if (dimmed) className += backlit ? ' sleep-screen-clear' : ' sleep-screen-dimmed';

  return (
    <dialog
      ref={dialogRef}
      className={className}
      aria-label={t(dimmed ? 'sleep.dimmed' : 'sleep.asleep')}
      onCancel={event => {
        // Escape wakes the screen (useScreenSleep) rather than closing the dialog behind React's back.
        event.preventDefault();
      }}
    >
      <button
        type="button"
        className="sleep-screen-button"
        aria-label={t('sleep.wake')}
        onPointerDown={event => event.preventDefault()}
        onClick={event => {
          event.stopPropagation();
          onWake();
        }}
      />
    </dialog>
  );
}
