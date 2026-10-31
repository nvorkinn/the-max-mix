import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Power, RotateCw } from 'lucide-react';
import { latestCommit, piVersion, rebootPi, restartKiosk } from '../utils/kiosk';

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
      className={`flex-1 flex items-center justify-center gap-2 p-3 min-h-12 rounded-2xl border text-xs font-bold active:scale-98 transition-all ${
        armed
          ? 'bg-rose-500/20 border-rose-400/40 text-rose-200'
          : 'bg-white/5 border-white/10 hover:bg-white/10 text-white'
      }`}
    >
      {icon}
      {armed ? confirmLabel : label}
    </button>
  );
}

/** The kiosk's own section of the settings: which commit the Pi runs, whether a newer one is out, and restart and reboot. */
export default function KioskSystem() {
  const [version] = useState(piVersion);
  type Latest = { state: 'checking' } | { state: 'unknown' } | { state: 'known'; commit: string };
  const [latest, setLatest] = useState<Latest>({ state: version ? 'checking' : 'unknown' });

  useEffect(() => {
    if (!version) return;
    const controller = new AbortController();
    void latestCommit(version.ref, controller.signal).then(commit => {
      if (!controller.signal.aborted) setLatest(commit ? { state: 'known', commit } : { state: 'unknown' });
    });
    return () => controller.abort();
  }, [version]);

  const updateWaiting = Boolean(version && latest.state === 'known' && !latest.commit.startsWith(version.commit));
  let status = 'The Pi did not say which version it runs.';
  if (version && latest.state === 'checking') status = `Checking GitHub for a newer ${version.ref}…`;
  if (version && latest.state === 'unknown') status = `Could not check GitHub for a newer ${version.ref}.`;
  if (version && latest.state === 'known') {
    status = updateWaiting
      ? `${version.ref} is now ${latest.commit.slice(0, 7)}. It reaches the Pi within about 5 minutes and applies at 04:30, or restart the kiosk once it has arrived.`
      : 'Up to date.';
  }

  return (
    <div className="space-y-2">
      <div className="p-3 rounded-2xl bg-white/5 border border-white/10">
        <div className="text-xs font-bold text-white">
          Pi software{' '}
          {version && (
            <span className="font-mono text-neutral-300">
              {version.ref} {version.commit}
            </span>
          )}
        </div>
        <p className={`text-[10px] mt-0.5 ${updateWaiting ? 'text-amber-300' : 'text-neutral-400'}`}>{status}</p>
      </div>
      <div className="flex gap-2">
        <ConfirmButton
          label="Restart kiosk"
          confirmLabel="Tap again to restart"
          icon={<RotateCw className="w-4 h-4 shrink-0 text-[#d5f580]" aria-hidden="true" />}
          onConfirm={restartKiosk}
        />
        <ConfirmButton
          label="Reboot Pi"
          confirmLabel="Tap again to reboot"
          icon={<Power className="w-4 h-4 shrink-0 text-[#d5f580]" aria-hidden="true" />}
          onConfirm={rebootPi}
        />
      </div>
    </div>
  );
}
