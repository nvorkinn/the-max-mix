import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Download, LoaderCircle, Power, RotateCw } from 'lucide-react';
import type { KioskUpdate } from '../hooks/useKioskUpdate';
import { rebootPi, restartKiosk } from '../utils/kiosk';

/** How long a first tap waits for the confirming second tap. */
const CONFIRM_MS = 4000;

/** A button that acts only on a second tap within a few seconds, so a stray touch never restarts anything. */
function ConfirmButton({
  label,
  confirmLabel,
  icon,
  busyLabel,
  onConfirm
}: Readonly<{
  label: string;
  confirmLabel: string;
  icon: ReactNode;
  /** While set, the button is disabled and shows this with a spinner: the action it starts is still running. */
  busyLabel?: string | undefined;
  onConfirm: () => void;
}>) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  if (busyLabel) {
    return (
      <button
        type="button"
        disabled
        className="modal-option flex-1 flex items-center justify-center gap-2 p-3 min-h-12 rounded-2xl border text-xs font-bold"
      >
        <LoaderCircle className="w-4 h-4 shrink-0 animate-spin" aria-hidden="true" />
        {busyLabel}
      </button>
    );
  }

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
      className={`modal-option flex-1 flex items-center justify-center gap-2 p-3 min-h-12 rounded-2xl border text-xs font-bold active:scale-98 transition-all ${armed ? 'modal-confirm-armed' : ''}`}
    >
      {icon}
      {armed ? confirmLabel : label}
    </button>
  );
}

/**
 * The kiosk's own section of the settings: which release (or pinned ref and commit) the Pi runs, whether a newer one is
 * out, update, restart and reboot. An update opens the full-screen update console (UpdateConsole).
 */
export default function KioskSystem({ update, onUpdate }: Readonly<{ update: KioskUpdate; onUpdate: () => void }>) {
  const { version, release, what, latest, newer, isUpdating, progress } = update;
  const updateWaiting = newer !== null;
  let status = 'The Pi did not say which version it runs.';
  if (version && latest.state === 'checking') status = `Checking GitHub for a newer ${what}…`;
  if (version && latest.state === 'unknown') status = `Could not check GitHub for a newer ${what}.`;
  if (version && latest.state === 'known') {
    status = newer
      ? `${newer}. Tap Update now, or the Pi picks it up within 6 hours and applies it at 04:30.`
      : 'Up to date.';
  }
  if (progress) status = progress;

  return (
    <div className="space-y-2">
      <div className="modal-card p-3 rounded-2xl border">
        <div className="text-xs font-bold">
          Pi software{' '}
          {version && (
            <span className="font-mono text-muted">{release ? version.ref : `${version.ref} ${version.commit}`}</span>
          )}
        </div>
        <p
          role="status"
          className={`mt-0.5 ${isUpdating ? 'font-semibold ' : ''}${updateWaiting ? 'status-warning' : 'text-muted'}`}
        >
          {status}
        </p>
      </div>
      <div className="flex gap-2">
        <ConfirmButton
          label="Update now"
          confirmLabel="Tap again to update"
          busyLabel={isUpdating ? 'Updating…' : undefined}
          icon={<Download className="w-4 h-4 shrink-0" aria-hidden="true" />}
          onConfirm={onUpdate}
        />
        <ConfirmButton
          label="Restart kiosk"
          confirmLabel="Tap again to restart"
          icon={<RotateCw className="w-4 h-4 shrink-0" aria-hidden="true" />}
          onConfirm={restartKiosk}
        />
        <ConfirmButton
          label="Reboot Pi"
          confirmLabel="Tap again to reboot"
          icon={<Power className="w-4 h-4 shrink-0" aria-hidden="true" />}
          onConfirm={rebootPi}
        />
      </div>
    </div>
  );
}
