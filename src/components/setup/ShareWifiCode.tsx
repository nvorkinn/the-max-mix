import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  KeyRound,
  LockKeyhole,
  QrCode,
  Trash2,
  UserRoundKey,
  Wifi
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useT } from '../../i18n/translate';

/** One of the Passwords app's groups: its round icon over its name, which the drawing leaves as a bar. */
function Group({ icon, name }: Readonly<{ icon: ReactNode; name?: string }>) {
  return (
    <div className={`wifi-share-group${name === undefined ? '' : ' wifi-share-group-wifi'}`}>
      {icon}
      <span>{name}</span>
      {name !== undefined && <i className="wifi-share-tap wifi-share-tap-wifi" />}
    </div>
  );
}

/** One network in the Passwords app's Wi-Fi list: its icon, its name and kind as bars, and the way in. */
function Network({ isCurrent = false }: Readonly<{ isCurrent?: boolean }>) {
  return (
    <div className={`wifi-share-net${isCurrent ? ' wifi-share-net-current' : ''}`}>
      <Wifi />
      <div>
        <span />
        <span />
      </div>
      <ChevronRight />
      {isCurrent && <i className="wifi-share-tap wifi-share-tap-network" />}
    </div>
  );
}

/**
 * A drawing of how an iPhone shows its Wi-Fi network as a QR code, played over and over: open the Passwords app, tap
 * Wi-Fi among its groups, tap the network (the one it is on comes first), then Show Network QR Code under the
 * network's details, and the code comes up. It follows the layout of the phone's screens in the app's own style, with
 * bars for what does not matter. With reduced motion it stays on the end: the code. The lines over it say the same in
 * words, so the drawing is hidden from screen readers. Each tap's ring sits in the thing it taps.
 */
export default function ShareWifiCode() {
  const t = useT();
  return (
    <div className="wifi-share" aria-hidden="true">
      <div className="wifi-share-screen wifi-share-home">
        <div className="wifi-share-app wifi-share-app-passwords">
          <KeyRound />
        </div>
        <div className="wifi-share-app" />
        <div className="wifi-share-app" />
        <div className="wifi-share-app" />
        <span className="wifi-share-app-name">{t('setup.wifi_passwords')}</span>
      </div>
      <div className="wifi-share-screen wifi-share-passwords">
        <div className="wifi-share-title">{t('setup.wifi_passwords')}</div>
        <div className="wifi-share-groups">
          <Group icon={<KeyRound />} />
          <Group icon={<UserRoundKey />} />
          <Group icon={<LockKeyhole />} />
          <Group icon={<Wifi />} name={t('setup.chapter_wifi')} />
          <Group icon={<CircleAlert />} />
          <Group icon={<Trash2 />} />
        </div>
      </div>
      <div className="wifi-share-screen wifi-share-networks">
        <div className="wifi-share-bar">
          <ChevronLeft />
          <b>{t('setup.chapter_wifi')}</b>
        </div>
        <Network isCurrent />
        <Network />
        <Network />
        <Network />
        <Network />
      </div>
      <div className="wifi-share-screen wifi-share-network">
        <div className="wifi-share-bar">
          <ChevronLeft />
        </div>
        <div className="wifi-share-details">
          <Wifi />
          <span className="wifi-share-details-name" />
          <span />
          <span />
          <span />
        </div>
        <div className="wifi-share-action wifi-share-action-show">
          {t('setup.wifi_show_code')}
          <i className="wifi-share-tap wifi-share-tap-show" />
        </div>
        <div className="wifi-share-action wifi-share-action-forget">
          <span />
        </div>
      </div>
      <div className="wifi-share-screen wifi-share-code">
        <QrCode />
      </div>
      <i className="wifi-share-tap wifi-share-tap-app" />
    </div>
  );
}
