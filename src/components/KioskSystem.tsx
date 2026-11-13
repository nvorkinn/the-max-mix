import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Power, RefreshCw, RotateCw } from 'lucide-react';
import type { KioskUpdate } from '../hooks/useKioskUpdate';
import { rebootPi, restartKiosk } from '../utils/kiosk';
import { SOFTWARE_LOOK, softwareState } from './settings/softwareStatus';

/** How long a first tap waits for the confirming second tap. */
const CONFIRM_MS = 4000;

/** A button that acts only on a second tap within a few seconds, so a stray touch never restarts anything. */
function ConfirmButton({
  label,
  confirmLabel,
  icon,
  onConfirm
}: Readonly<{ label: string; confirmLabel: string; icon: ReactNode; onConfirm: () => void }>) {
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
      className={`modal-option settings-action flex-1 flex items-center justify-center gap-2 rounded-2xl border font-bold active:scale-98 transition-all ${armed ? 'modal-confirm-armed' : ''}`}
    >
      {icon}
      {armed ? confirmLabel : label}
    </button>
  );
}

/**
 * The kiosk's own section of the settings: which release (or pinned ref and commit) the Pi runs, whether a newer one is
 * out, restart and reboot. The button beside the version asks GitHub again; a newer version it finds is asked about in
 * the update popup (UpdatePrompt), which is where an update starts, so after "Not now" the same button offers it again.
 */
export default function KioskSystem({ update }: Readonly<{ update: KioskUpdate }>) {
  const { version, release, what, latest, newer, isChecking, isUpdating, progress, checkNow } = update;
  let status = 'The Pi did not say which version it runs.';
  if (version && latest.state === 'checking') status = `Checking GitHub for a newer ${what}…`;
  if (version && latest.state === 'unknown') status = `Could not check GitHub for a newer ${what}.`;
  if (version && latest.state === 'known') {
    status = newer
      ? `${newer}. Tap the button to install it now, or the Pi picks it up within 6 hours and applies it at 04:30.`
      : 'Up to date.';
  }
  if (progress) status = progress;

  const look = SOFTWARE_LOOK[softwareState(update)];
  const StatusIcon = look.icon;

  return (
    <div className="settings-stack">
      <div className="settings-box flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="settings-box-title">
            Pi software{' '}
            {version && (
              <span className="font-mono text-muted">{release ? version.ref : `${version.ref} ${version.commit}`}</span>
            )}
          </div>
          <p role="status" className={`settings-status ${isUpdating ? 'font-semibold ' : ''}${look.tone}`}>
            <StatusIcon className={`settings-status-icon ${look.spin ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{status}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => checkNow(true)}
          disabled={!version || isChecking || isUpdating}
          aria-label="Check for updates"
          className="modal-icon-button shrink-0 rounded-full border active:scale-90 flex items-center justify-center transition-all"
        >
          <RefreshCw className={`w-6 h-6 ${isChecking ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
      </div>
      <div className="flex gap-3">
        <ConfirmButton
          label="Restart kiosk"
          confirmLabel="Tap again to restart"
          icon={<RotateCw className="w-5 h-5 shrink-0" aria-hidden="true" />}
          onConfirm={restartKiosk}
        />
        <ConfirmButton
          label="Reboot Pi"
          confirmLabel="Tap again to reboot"
          icon={<Power className="w-5 h-5 shrink-0" aria-hidden="true" />}
          onConfirm={rebootPi}
        />
      </div>
    </div>
  );
}
