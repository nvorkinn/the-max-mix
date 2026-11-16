import type { TouchscreenConfig } from 'countdown-api';
import { deviceCredentials } from '../../countdown/registration';
import type { KioskUpdate } from '../../hooks/useKioskUpdate';
import KioskSystem from '../KioskSystem';
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
 * version everywhere.
 */
export default function AboutSettings({
  kioskUpdate,
  deviceConfig,
  wifi,
  kiosk
}: Readonly<{
  kioskUpdate: KioskUpdate | undefined;
  /** countdown-server's config, once someone owns the kiosk: the size it reported comes from it. */
  deviceConfig: TouchscreenConfig | undefined;
  wifi: WifiState;
  kiosk: boolean;
}>) {
  const deviceId = deviceConfig?.device_id ?? deviceCredentials()?.deviceId;
  let address = 'Unknown';
  if (wifi.state === 'loading') address = '…';
  else if ((wifi.state === 'connected' || wifi.state === 'disconnected') && wifi.address) address = wifi.address;
  else if (wifi.state === 'disconnected') address = 'Not connected';

  return (
    <div className="settings-stack">
      <section className="settings-group" aria-labelledby="about-screen-label">
        <h5 className="settings-group-title" id="about-screen-label">
          This screen
        </h5>
        <dl className="settings-box about-facts">
          <Fact name="Device ID" value={deviceId ?? 'Not registered'} />
          {deviceConfig && <Fact name="Size" value={`${deviceConfig.width} × ${deviceConfig.height}`} />}
          {kiosk && <Fact name="IP address" value={address} />}
          <Fact name="App version" value={APP_VERSION} />
        </dl>
      </section>
      {kioskUpdate && (
        <section className="settings-group" aria-labelledby="about-software-label">
          <h5 className="settings-group-title" id="about-software-label">
            Software
          </h5>
          <KioskSystem update={kioskUpdate} />
        </section>
      )}
    </div>
  );
}
