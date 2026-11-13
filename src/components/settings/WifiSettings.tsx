import { Wifi, WifiOff } from 'lucide-react';
import { openWifiSettings } from '../../utils/kiosk';
import { wifiLabel } from './wifi';
import type { WifiState } from './wifi';

/**
 * The network the kiosk is on, and the button that opens the kiosk's own Wi-Fi setup page (served by its service, so it
 * works offline), where networks are listed and passwords typed.
 */
export default function WifiSettings({ wifi }: Readonly<{ wifi: WifiState }>) {
  const network = wifiLabel(wifi);
  const Icon = wifi.state === 'disconnected' ? WifiOff : Wifi;
  return (
    <div className="settings-stack">
      <div className="settings-box flex items-center gap-4">
        <span className="settings-box-icon">
          <Icon className="w-6 h-6" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="settings-box-title">Network</div>
          {network !== undefined && (
            <div
              data-testid="wifi-network"
              className={`settings-box-value truncate ${wifi.state === 'connected' ? '' : 'text-muted'}`}
            >
              {network}
            </div>
          )}
        </div>
      </div>
      <button type="button" onClick={openWifiSettings} className="button button-secondary settings-wide-button">
        <Wifi className="w-5 h-5 shrink-0" aria-hidden="true" />
        {wifi.state === 'connected' ? 'Change network' : 'Choose network'}
      </button>
    </div>
  );
}
