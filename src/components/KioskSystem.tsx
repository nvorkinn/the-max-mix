import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Download, Power, RotateCw } from 'lucide-react';
import { isRelease, latestCommit, latestRelease, piVersion, rebootPi, restartKiosk, updateKiosk } from '../utils/kiosk';

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
      className={`modal-option flex-1 flex items-center justify-center gap-2 p-3 min-h-12 rounded-2xl border text-xs font-bold active:scale-98 transition-all ${armed ? 'modal-confirm-armed' : ''}`}
    >
      {icon}
      {armed ? confirmLabel : label}
    </button>
  );
}

/**
 * The kiosk's own section of the settings: which release (or pinned ref and commit) the Pi runs, whether a newer one is
 * out, update, restart and reboot.
 */
export default function KioskSystem() {
  const [version] = useState(piVersion);
  const [isUpdating, setIsUpdating] = useState(false);
  // The newest release tag on GitHub for a Pi on a release, otherwise the newest commit of the ref it is pinned to.
  type Latest = { state: 'checking' } | { state: 'unknown' } | { state: 'known'; value: string };
  const [latest, setLatest] = useState<Latest>({ state: version ? 'checking' : 'unknown' });

  useEffect(() => {
    if (!version) return;
    const controller = new AbortController();
    const latestValue = isRelease(version.ref)
      ? latestRelease(controller.signal)
      : latestCommit(version.ref, controller.signal);
    void latestValue.then(value => {
      if (!controller.signal.aborted) setLatest(value ? { state: 'known', value } : { state: 'unknown' });
    });
    return () => controller.abort();
  }, [version]);

  const release = Boolean(version && isRelease(version.ref));
  const newer = (() => {
    if (!version || latest.state !== 'known') return null;
    if (release) return latest.value === version.ref ? null : `${latest.value} is out`;
    return latest.value.startsWith(version.commit) ? null : `${version.ref} is now ${latest.value.slice(0, 7)}`;
  })();
  const updateWaiting = newer !== null;
  const what = release ? 'release' : version?.ref;
  let status = 'The Pi did not say which version it runs.';
  if (version && latest.state === 'checking') status = `Checking GitHub for a newer ${what}…`;
  if (version && latest.state === 'unknown') status = `Could not check GitHub for a newer ${what}.`;
  if (version && latest.state === 'known') {
    status = newer
      ? `${newer}. Tap Update now, or the Pi picks it up within 6 hours and applies it at 04:30.`
      : 'Up to date.';
  }
  if (isUpdating) status = 'Updating. If there is a newer version, the kiosk restarts by itself in a few minutes.';

  const update = () => {
    setIsUpdating(true);
    updateKiosk();
  };

  return (
    <div className="space-y-2">
      <div className="modal-card p-3 rounded-2xl border">
        <div className="text-xs font-bold">
          Pi software{' '}
          {version && (
            <span className="font-mono text-muted">{release ? version.ref : `${version.ref} ${version.commit}`}</span>
          )}
        </div>
        <p className={`text-[10px] mt-0.5 ${updateWaiting ? 'status-warning' : 'text-muted'}`}>{status}</p>
      </div>
      <div className="flex gap-2">
        <ConfirmButton
          label="Update now"
          confirmLabel="Tap again to update"
          icon={<Download className="w-4 h-4 shrink-0" aria-hidden="true" />}
          onConfirm={update}
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
