import { WifiOff } from 'lucide-react';
import { isKiosk, openWifiSettings } from '../utils/kiosk';
import { useLanguage } from '../i18n/language';
import { useT } from '../i18n/translate';

/** Full-width notice for a lost internet connection. Only the kiosk can offer the Wi-Fi panel. */
export default function OfflineBanner() {
  const t = useT();
  const language = useLanguage();
  return (
    <div className="connection-banner offline-banner" role="alert">
      <WifiOff size={20} aria-hidden="true" />
      <span>
        <strong>{t('offline.title')}</strong>
        <br />
        {t('offline.text')}
      </span>
      {isKiosk() && (
        <button type="button" onClick={() => openWifiSettings(language)}>
          {t('offline.wifi')}
        </button>
      )}
    </div>
  );
}
