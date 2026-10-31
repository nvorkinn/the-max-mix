import { WifiOff } from 'lucide-react';
import { isKiosk, openWifiSettings } from '../utils/kiosk';

/** Full-width notice for a lost internet connection. Only the kiosk can offer the Wi-Fi panel. */
export default function OfflineBanner() {
  return (
    <div className="connection-banner offline-banner" role="alert">
      <WifiOff size={20} aria-hidden="true" />
      <span>
        <strong>No internet connection</strong>
        <br />
        Reconnect to use Spotify controls. Music on another speaker may continue.
      </span>
      {isKiosk() && (
        <button type="button" onClick={openWifiSettings}>
          Wi-Fi settings
        </button>
      )}
    </div>
  );
}
