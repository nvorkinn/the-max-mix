import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Download, Power, RotateCw } from 'lucide-react';
import {
  isRelease,
  latestCommit,
  latestRelease,
  piVersion,
  rebootPi,
  restartKiosk,
  updateKiosk,
  type PiVersion
} from '../utils/kiosk';
import {
  describeUpdate,
  getPiUpdate,
  installProgress,
  isActive,
  noteUpdateRequested,
  subscribePiUpdate,
  watchPiUpdates,
  type PiUpdate,
  type UpdateStatus
} from '../utils/piUpdate';

/** How long a first tap waits for the confirming second tap. */
const CONFIRM_MS = 4000;

/** A button that acts only on a second tap within a few seconds, so a stray touch never restarts anything. */
function ConfirmButton({
  label,
  confirmLabel,
  icon,
  onConfirm,
  disabled = false
}: Readonly<{ label: string; confirmLabel: string; icon: ReactNode; onConfirm: () => void; disabled?: boolean }>) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <button
      type="button"
      disabled={disabled}
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
      className={`modal-option flex-1 flex items-center justify-center gap-2 p-3 min-h-12 rounded-2xl border text-xs font-bold active:scale-98 transition-all disabled:opacity-50 ${armed ? 'modal-confirm-armed' : ''}`}
    >
      {icon}
      {armed ? confirmLabel : label}
    </button>
  );
}

/** How long after a tap the settings wait for the Pi to start the update before saying it did not. */
const START_MS = 20_000;
/** How long after a finished update the settings still say what it installed. */
const RECENT_MS = 10 * 60_000;

/** True when the Pi now runs what `status` installed. */
function runs(version: PiVersion, status: UpdateStatus): boolean {
  return isRelease(version.ref) ? status.ref === version.ref : status.commit.startsWith(version.commit);
}

type Tone = 'muted' | 'warning' | 'danger';
interface UpdateLine {
  text: string;
  tone: Tone;
  /** 0 to 1 for a bar, null for a bar that only shows something is happening, undefined for none. */
  progress?: number | null;
}

/**
 * What the updater says, when it has something to say: a run under way, the run a tap started, a failure, or an update
 * that waits for a restart. Null leaves the line to the GitHub check.
 */
function updateLine(update: PiUpdate, version: PiVersion | null, now: number): UpdateLine | null {
  const { status, reachable, requestedAt } = update;
  if (status && isActive(status, now)) {
    return { text: describeUpdate(status), tone: 'muted', progress: installProgress(status) };
  }
  if (requestedAt !== null) {
    if (reachable === false) {
      return {
        text: 'Updating. If there is a newer version, the kiosk restarts by itself in a few minutes.',
        tone: 'muted'
      };
    }
    // kiosk-pull writes whole seconds, so a run started by this tap can look up to a second older than the tap.
    if (status && status.state !== 'idle' && status.started >= requestedAt - 2000) {
      if (status.state === 'restart-needed') {
        return {
          text: `Installed ${status.ref || 'the update'}. Restarting the kiosk…`,
          tone: 'muted',
          progress: null
        };
      }
      return { text: describeUpdate(status), tone: status.state === 'failed' ? 'danger' : 'muted' };
    }
    return now - requestedAt < START_MS
      ? { text: 'Asking the Pi to update…', tone: 'muted', progress: null }
      : { text: 'The Pi has not started the update. Try again, or restart the kiosk.', tone: 'warning' };
  }
  if (!status || !version) return null;
  if (status.state === 'failed') {
    const when = new Date(status.updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    return { text: `The last update (${when}) failed: ${status.detail || 'no reason given.'}`, tone: 'danger' };
  }
  if (status.state === 'restart-needed' || status.state === 'installed') {
    if (!runs(version, status)) {
      return {
        text: `${status.ref || 'An update'} is installed and applies when the kiosk restarts (at 04:30, or tap Restart kiosk).`,
        tone: 'warning'
      };
    }
    if (now - status.updated < RECENT_MS) return { text: `Updated to ${status.ref}.`, tone: 'muted' };
  }
  return null;
}

const TONE_CLASS: Record<Tone, string> = { muted: 'text-muted', warning: 'status-warning', danger: 'status-danger' };

function startUpdate(): void {
  noteUpdateRequested();
  updateKiosk();
}

/**
 * The kiosk's own section of the settings: which release (or pinned ref and commit) the Pi runs, whether a newer one is
 * out, update, restart and reboot.
 */
export default function KioskSystem() {
  const [version] = useState(piVersion);
  const update = useSyncExternalStore(subscribePiUpdate, getPiUpdate);
  useEffect(watchPiUpdates, []);
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
  const line = updateLine(update, version, update.checkedAt);
  const busy = isActive(update.status, update.checkedAt);
  let tone: Tone = updateWaiting ? 'warning' : 'muted';
  if (line) tone = line.tone;

  return (
    <div className="space-y-2">
      <div className="modal-card p-3 rounded-2xl border">
        <div className="text-xs font-bold">
          Pi software{' '}
          {version && (
            <span className="font-mono text-muted">{release ? version.ref : `${version.ref} ${version.commit}`}</span>
          )}
        </div>
        <p role="status" className={`text-[10px] mt-0.5 ${TONE_CLASS[tone]}`}>
          {line?.text ?? status}
        </p>
        {line?.progress !== undefined && (
          <div
            className="update-progress mt-1.5"
            role="progressbar"
            aria-label="Update progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={line.progress === null ? undefined : Math.round(line.progress * 100)}
          >
            <div
              className={line.progress === null ? 'update-progress-busy' : 'update-progress-fill'}
              style={line.progress === null ? undefined : { width: `${Math.round(line.progress * 100)}%` }}
            />
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <ConfirmButton
          label="Update now"
          confirmLabel="Tap again to update"
          icon={<Download className="w-4 h-4 shrink-0" aria-hidden="true" />}
          onConfirm={startUpdate}
          disabled={busy}
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
