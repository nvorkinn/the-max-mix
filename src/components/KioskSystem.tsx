import { useEffect, useRef, useState } from 'react';
import { Power, RefreshCw, RotateCw } from 'lucide-react';
import type { KioskUpdate } from '../hooks/useKioskUpdate';
import { rebootPi, restartKiosk } from '../utils/kiosk';
import ConfirmButton from './ConfirmButton';
import { SOFTWARE_LOOK, softwareState } from './settings/softwareStatus';

/** The refresh button spins at least this long, so a check GitHub answers at once still shows it ran. */
const MIN_SPIN_MS = 800;

const formatTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

/**
 * The kiosk's own section of the settings: which release (or pinned ref and commit) the Pi runs, whether a newer one is
 * out, restart and reboot. The button beside the version asks GitHub again; a newer version it finds is asked about in
 * the update popup (UpdatePrompt), which is where an update starts, so after "Not now" the same button offers it again.
 */
export default function KioskSystem({ update }: Readonly<{ update: KioskUpdate }>) {
  const { version, release, what, latest, newer, isChecking, checkedAt, isUpdating, progress, checkNow } = update;
  const [pressed, setPressed] = useState(false);
  const spinTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(spinTimerRef.current), []);
  const spinning = isChecking || pressed;
  let status = 'The Pi did not say which version it runs.';
  if (version && latest.state === 'checking') status = `Checking GitHub for a newer ${what}…`;
  if (version && latest.state === 'unknown') status = `Could not check GitHub for a newer ${what}.`;
  if (version && latest.state === 'known') {
    status = newer
      ? `${newer}. Tap the button to install it now, or the Pi picks it up within 6 hours and applies it at 04:30.`
      : 'Up to date.';
    if (!newer && checkedAt !== null) status = `Up to date as of ${formatTime(checkedAt)}.`;
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
          onClick={() => {
            checkNow(true);
            setPressed(true);
            clearTimeout(spinTimerRef.current);
            spinTimerRef.current = setTimeout(() => setPressed(false), MIN_SPIN_MS);
          }}
          disabled={!version || spinning || isUpdating}
          aria-label="Check for updates"
          className="modal-icon-button shrink-0 rounded-full border active:scale-90 flex items-center justify-center transition-all"
        >
          <RefreshCw className={`w-6 h-6 ${spinning ? 'animate-spin' : ''}`} aria-hidden="true" />
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
