import { useEffect, useRef, useState } from 'react';
import { Power, RefreshCw, RotateCw } from 'lucide-react';
import type { KioskUpdate } from '../hooks/useKioskUpdate';
import { rebootPi, restartKiosk } from '../utils/kiosk';
import { useT } from '../i18n/translate';
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
  const { version, release, what = '', latest, newer, isChecking, checkedAt, isUpdating, progress, checkNow } = update;
  const [pressed, setPressed] = useState(false);
  const spinTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(spinTimerRef.current), []);
  const t = useT();
  const spinning = isChecking || pressed;
  let status = t('about.no_version');
  if (version && latest.state === 'checking') status = t('about.checking', { what });
  if (version && latest.state === 'unknown') status = t('about.check_failed', { what });
  if (version && latest.state === 'known') {
    status = newer ? t('about.newer', { newer }) : t('about.up_to_date');
    if (!newer && checkedAt !== null) status = t('about.up_to_date_at', { time: formatTime(checkedAt) });
  }
  if (progress) status = progress;

  const look = SOFTWARE_LOOK[softwareState(update)];
  const StatusIcon = look.icon;

  return (
    <div className="settings-stack">
      <div className="settings-box flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="settings-box-title">
            {t('about.pi_software')}{' '}
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
          aria-label={t('about.check')}
          className="modal-icon-button shrink-0 rounded-full border active:scale-90 flex items-center justify-center transition-all"
        >
          <RefreshCw className={`w-6 h-6 ${spinning ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
      </div>
      <div className="flex gap-3">
        <ConfirmButton
          label={t('about.restart')}
          confirmLabel={t('about.restart_confirm')}
          icon={<RotateCw className="w-5 h-5 shrink-0" aria-hidden="true" />}
          onConfirm={restartKiosk}
        />
        <ConfirmButton
          label={t('about.reboot')}
          confirmLabel={t('about.reboot_confirm')}
          icon={<Power className="w-5 h-5 shrink-0" aria-hidden="true" />}
          onConfirm={rebootPi}
        />
      </div>
    </div>
  );
}
