import { Check, KeyRound, QrCode, Wifi } from 'lucide-react';
import { useT } from '../../i18n/translate';

/**
 * A drawing of how an iPhone shows its Wi-Fi network as a QR code, played over and over: open the Passwords app, tap
 * Wi-Fi, tap the network (the one it is on comes first), then Show Network QR Code, and the code comes up. It is drawn
 * in the app's own style, not a picture of the phone's apps. With reduced motion it stays on the end: the code. The
 * lines over it say the same in words, so the drawing is hidden from screen readers.
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
        <div className="wifi-share-row wifi-share-row-named">
          <Wifi />
          <span>{t('setup.chapter_wifi')}</span>
        </div>
        <div className="wifi-share-row">
          <KeyRound />
          <span />
        </div>
        <div className="wifi-share-row">
          <KeyRound />
          <span />
        </div>
      </div>
      <div className="wifi-share-screen wifi-share-networks">
        <div className="wifi-share-title">{t('setup.chapter_wifi')}</div>
        <div className="wifi-share-row wifi-share-row-current">
          <Wifi />
          <span />
          <Check />
        </div>
        <div className="wifi-share-row">
          <Wifi />
          <span />
        </div>
        <div className="wifi-share-row">
          <Wifi />
          <span />
        </div>
      </div>
      <div className="wifi-share-screen wifi-share-network">
        <div className="wifi-share-title wifi-share-title-bar">
          <span />
        </div>
        <div className="wifi-share-row wifi-share-row-named wifi-share-row-show">
          <QrCode />
          <span>{t('setup.wifi_show_code')}</span>
        </div>
        <div className="wifi-share-row">
          <KeyRound />
          <span />
        </div>
      </div>
      <div className="wifi-share-screen wifi-share-code">
        <QrCode />
      </div>
      <span className="wifi-share-tap wifi-share-tap-app" />
      <span className="wifi-share-tap wifi-share-tap-wifi" />
      <span className="wifi-share-tap wifi-share-tap-network" />
      <span className="wifi-share-tap wifi-share-tap-show" />
    </div>
  );
}
