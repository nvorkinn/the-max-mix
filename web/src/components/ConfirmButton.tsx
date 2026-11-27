import { type ReactNode, useEffect, useRef, useState } from 'react';

/** How long a first tap waits for the confirming second tap. */
const CONFIRM_MS = 4000;

/** A button that acts only on a second tap within a few seconds, so a stray touch never restarts or removes anything. */
export default function ConfirmButton({
  label,
  confirmLabel,
  icon,
  onConfirm,
  className = 'flex-1'
}: Readonly<{ label: string; confirmLabel: string; icon: ReactNode; onConfirm: () => void; className?: string }>) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <button
      type="button"
      onClick={() => {
        clearTimeout(timerRef.current);
        if (armed) {
          setArmed(false);
          onConfirm();
          return;
        }
        setArmed(true);
        timerRef.current = setTimeout(() => setArmed(false), CONFIRM_MS);
      }}
      className={`modal-option settings-action ${className} flex items-center justify-center gap-2 rounded-2xl border font-bold active:scale-98 transition-all ${armed ? 'modal-confirm-armed' : ''}`}
    >
      {icon}
      {armed ? confirmLabel : label}
    </button>
  );
}
