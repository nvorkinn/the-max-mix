import { Bluetooth, ChevronLeft, LoaderCircle, Settings, Wifi } from 'lucide-react';
import { useT } from '../../i18n/translate';

/**
 * A drawing of how to get a phone ready to be paired, played over and over: open Settings, then Bluetooth, and the
 * phone looks for devices, which is when the kiosk hears it best. It is drawn like the Wi-Fi chapter's drawing
 * (ShareWifiCode), whose phone, screens and taps it shares, in the app's own style. With reduced motion it stays on
 * the end: the Bluetooth page. The line over it says the same in words, so the drawing is hidden from screen readers.
 */
export default function OpenBluetooth() {
  const t = useT();
  return (
    <div className="wifi-share phone-bluetooth" aria-hidden="true">
      <div className="wifi-share-screen wifi-share-home">
        <div className="wifi-share-app wifi-share-app-passwords">
          <Settings />
        </div>
        <div className="wifi-share-app" />
        <div className="wifi-share-app" />
        <div className="wifi-share-app" />
        <span className="wifi-share-app-name">{t('pair.settings')}</span>
      </div>
      <div className="wifi-share-screen phone-bluetooth-settings">
        <div className="wifi-share-title">{t('pair.settings')}</div>
        <div className="phone-bluetooth-item">
          <Wifi />
          <span>{t('setup.chapter_wifi')}</span>
        </div>
        <div className="phone-bluetooth-item phone-bluetooth-row">
          <Bluetooth />
          <span>{t('pair.bluetooth')}</span>
          <i className="wifi-share-tap phone-bluetooth-tap" />
        </div>
        <div className="phone-bluetooth-item phone-bluetooth-item-bar">
          <Settings />
          <span />
        </div>
      </div>
      <div className="wifi-share-screen phone-bluetooth-page">
        <div className="wifi-share-bar">
          <ChevronLeft />
          <b>{t('pair.bluetooth')}</b>
        </div>
        <div className="phone-bluetooth-item phone-bluetooth-on">
          <Bluetooth />
          <span>{t('pair.bluetooth')}</span>
          <i className="phone-bluetooth-switch" />
        </div>
        <div className="phone-bluetooth-looking">
          <LoaderCircle className="animate-spin" />
          <span />
        </div>
      </div>
      <i className="wifi-share-tap wifi-share-tap-app" />
    </div>
  );
}
