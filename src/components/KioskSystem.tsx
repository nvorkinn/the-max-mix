import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Download, LoaderCircle, Power, RotateCw } from 'lucide-react';
import { debugLog } from '../utils/debugLog';
import { getUpdateStatus } from '../utils/kioskService';
import { isRelease, latestCommit, latestRelease, piVersion, rebootPi, restartKiosk, updateKiosk } from '../utils/kiosk';

const POLL_MS = 1500;
/** Give up following an update after this long; a pull of a big release can take minutes. */
const GIVE_UP_MS = 20 * 60 * 1000;

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
 * out, update, restart and reboot.
 */
export default function KioskSystem() {
  const [version] = useState(piVersion);
  const [isUpdating, setIsUpdating] = useState(false);
  // What the update says it is doing, from the kiosk service; null until it has said anything.
  const [progress, setProgress] = useState<string | null>(null);
  // The last lines the update has printed, shown as they arrive.
  const [output, setOutput] = useState<string[]>([]);
  const outputRef = useRef<HTMLPreElement>(null);
  // The newest release tag on GitHub for a Pi on a release, otherwise the newest commit of the ref it is pinned to.
  type Latest = { state: 'checking' } | { state: 'unknown' } | { state: 'known'; value: string };
  const [latest, setLatest] = useState<Latest>({ state: version ? 'checking' : 'unknown' });

  // While an update runs, follow it: show its latest line, and write every line to the debug console.
  useEffect(() => {
    if (!isUpdating) return;
    const started = Date.now();
    let logged = 0;
    let hasSeenRunning = false;
    let misses = 0;
    const timer = setInterval(() => {
      void getUpdateStatus().then(status => {
        if (!status) {
          misses += 1;
          // The service ends with the kiosk: after it was seen running, no answer means the kiosk is restarting.
          if (hasSeenRunning) setProgress('Restarting the kiosk…');
          else if (misses >= 5) setProgress('The kiosk service is not answering.');
          return;
        }
        misses = 0;
        // Nothing has started yet (any log is from an earlier pull), or the log began again.
        if (status.state === 'idle') return;
        if (status.total < logged) logged = 0;
        const count = Math.min(status.total - logged, status.lines.length);
        const fresh = count > 0 ? status.lines.slice(-count) : [];
        for (const line of fresh) debugLog('info', 'update', line);
        logged = status.total;
        const last = status.lines.at(-1);
        setOutput(status.lines);
        if (status.state === 'running') {
          hasSeenRunning = true;
        } else if (status.state === 'done') {
          setProgress('Update finished. Nothing needed a restart.');
          setIsUpdating(false);
        } else {
          setProgress(`The update failed. ${last ?? ''}`.trim());
          setIsUpdating(false);
        }
      });
      if (Date.now() - started > GIVE_UP_MS) setIsUpdating(false);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [isUpdating]);

  // Keep the newest output in view.
  useEffect(() => {
    const element = outputRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [output]);

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
  if (isUpdating) status = progress ?? 'Updating… this can take a few minutes.';
  else if (progress) status = progress;

  const update = () => {
    setProgress(null);
    setOutput([]);
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
        <p
          role="status"
          className={`${isUpdating ? 'text-xs font-semibold' : 'text-[10px]'} mt-0.5 ${updateWaiting ? 'status-warning' : 'text-muted'}`}
        >
          {status}
        </p>
      </div>
      {(isUpdating || output.length > 0) && (
        <pre
          ref={outputRef}
          aria-label="Update output"
          className="modal-card rounded-xl border p-2 font-mono text-[10px] leading-4 max-h-28 overflow-y-auto whitespace-pre-wrap break-words select-text"
        >
          {output.length > 0 ? output.join('\n') : 'Starting the update…'}
        </pre>
      )}
      <div className="flex gap-2">
        <ConfirmButton
          label="Update now"
          confirmLabel="Tap again to update"
          busyLabel={isUpdating ? 'Updating…' : undefined}
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
