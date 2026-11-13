import type { KioskUpdate } from '../../hooks/useKioskUpdate';
import KioskSystem from '../KioskSystem';
import { APP_VERSION } from './appVersion';

/** The Pi's software, restart and reboot on the kiosk, and the app's own version everywhere. */
export default function SoftwareSettings({ kioskUpdate }: Readonly<{ kioskUpdate: KioskUpdate | undefined }>) {
  return (
    <div className="settings-stack">
      {kioskUpdate && <KioskSystem update={kioskUpdate} />}
      <p className="text-muted">
        Version <span className="font-mono">{APP_VERSION}</span>
      </p>
    </div>
  );
}
