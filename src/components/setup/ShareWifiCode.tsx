import { Check, QrCode, Wifi } from 'lucide-react';
import { useT } from '../../i18n/translate';

/**
 * A drawing of how a phone shows its Wi-Fi network as a QR code, played over and over: in the phone's Wi-Fi settings,
 * tap the network it is on, then Share, and the code comes up. It is drawn in the app's own style, not a picture of any
 * phone's settings. With reduced motion it stays on the end: the code. The line over it says the same in words, so the
 * drawing is hidden from screen readers.
 */
export default function ShareWifiCode() {
  const t = useT();
  return (
    <div className="wifi-share" aria-hidden="true">
      <div className="wifi-share-title">{t('setup.chapter_wifi')}</div>
      <div className="wifi-share-row wifi-share-network">
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
      <span className="wifi-share-tap wifi-share-tap-network" />
      <div className="wifi-share-sheet">
        <div className="wifi-share-button">
          <QrCode />
          <span>{t('setup.wifi_share')}</span>
        </div>
        <span className="wifi-share-tap wifi-share-tap-share" />
      </div>
      <div className="wifi-share-code">
        <QrCode />
      </div>
    </div>
  );
}
