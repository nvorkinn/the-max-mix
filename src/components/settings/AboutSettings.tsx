import type { TouchscreenConfig } from 'countdown-api';
import { Bug } from 'lucide-react';
import { deviceCredentials } from '../../countdown/registration';
import type { KioskUpdate } from '../../hooks/useKioskUpdate';
import KioskSystem from '../KioskSystem';
import { useT } from '../../i18n/translate';
import { APP_VERSION } from './appVersion';
import type { WifiState } from './wifi';

/** One fact about the screen: its name, and its value in a typeface that tells 0 from O. */
function Fact({ name, value }: Readonly<{ name: string; value: string }>) {
  return (
    <div className="about-fact">
      <dt className="text-muted">{name}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}

/**
 * The About page: what this screen is (its device ID, its size as it told countdown-server, and on the kiosk its IP
 * address), then its software: the Pi's version, the update check, restart and reboot on the kiosk, and the app's own
 * version everywhere, and at the bottom of the page a way into the debug console.
 */
export default function AboutSettings({
  kioskUpdate,
  deviceConfig,
  wifi,
  kiosk,
  onOpenDebug
}: Readonly<{
  kioskUpdate: KioskUpdate | undefined;
  /** countdown-server's config, once someone owns the kiosk: the size it reported comes from it. */
  deviceConfig: TouchscreenConfig | undefined;
  wifi: WifiState;
  kiosk: boolean;
  /** Opens the debug console, which otherwise takes holding the clock or Ctrl+Shift+D. */
  onOpenDebug?: (() => void) | undefined;
}>) {
  const t = useT();
  const deviceId = deviceConfig?.device_id ?? deviceCredentials()?.deviceId;
  let address = t('about.unknown');
  if (wifi.state === 'loading') address = '…';
  else if ((wifi.state === 'connected' || wifi.state === 'disconnected') && wifi.address) address = wifi.address;
  else if (wifi.state === 'disconnected') address = t('wifi.not_connected');

  return (
    <div className="settings-stack about-page">
      <section className="settings-group" aria-labelledby="about-screen-label">
        <h5 className="settings-group-title" id="about-screen-label">
          {t('about.this_screen')}
        </h5>
        <dl className="settings-box about-facts">
          <Fact name={t('about.device_id')} value={deviceId ?? t('about.not_registered')} />
          {deviceConfig && <Fact name={t('about.size')} value={`${deviceConfig.width} × ${deviceConfig.height}`} />}
          {kiosk && <Fact name={t('about.ip_address')} value={address} />}
          <Fact name={t('about.app_version')} value={APP_VERSION} />
        </dl>
      </section>
      {kioskUpdate && (
        <section className="settings-group" aria-labelledby="about-software-label">
          <h5 className="settings-group-title" id="about-software-label">
            {t('about.software')}
          </h5>
          <KioskSystem update={kioskUpdate} />
        </section>
      )}
      {onOpenDebug && (
        <div className="flex about-debug">
          <button
            type="button"
            onClick={onOpenDebug}
            className="modal-option settings-action flex-1 flex items-center justify-center gap-2 rounded-2xl border font-bold active:scale-98 transition-all"
          >
            <Bug className="w-5 h-5 shrink-0" aria-hidden="true" />
            {t('about.debug')}
          </button>
        </div>
      )}
    </div>
  );
}
