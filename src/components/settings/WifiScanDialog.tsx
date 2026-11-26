import { useId, useState } from 'react';
import { useLanguage } from '../../i18n/language';
import { useT } from '../../i18n/translate';
import { joinWifi } from '../../utils/kioskWifi';
import Modal from '../Modal';
import WifiJoinProgress from './WifiJoinProgress';
import WifiScanView from './WifiScanView';
import type { ReadNetwork } from './WifiScanView';

/**
 * Settings > Wi-Fi's Scan code: joins the network whose QR code is held up to the kiosk's camera. It shows what the
 * camera sees (WifiScanView) until a code is read, then how joining that network goes (WifiJoinProgress): a spinner,
 * then a tick with the network's name and Continue. Closes with `onJoined` at Continue, or however else it is closed
 * once the kiosk is on the network.
 */
export default function WifiScanDialog({ onJoined, onClose }: Readonly<{ onJoined: () => void; onClose: () => void }>) {
  const t = useT();
  const language = useLanguage();
  const titleId = useId();
  const [joining, setJoining] = useState<{ ssid: string; isJoined: boolean; error?: string } | null>(null);
  const join = async (network: ReadNetwork) => {
    setJoining({ ssid: network.ssid, isJoined: false });
    const result = await joinWifi(network, language);
    setJoining(
      result.ok
        ? { ssid: network.ssid, isJoined: true }
        : { ssid: network.ssid, isJoined: false, error: result.error ?? t('wifi.unreachable') }
    );
  };
  return (
    <Modal
      labelledBy={titleId}
      onClose={joining?.isJoined ? onJoined : onClose}
      className="app-modal-panel wifi-scan border rounded-3xl p-6 shadow-2xl text-left select-none"
    >
      <div className="modal-header">
        <h3 id={titleId} className="text-lg font-semibold truncate">
          {t('wifi.scan_title')}
        </h3>
      </div>
      {joining ? (
        <WifiJoinProgress
          ssid={joining.ssid}
          isJoined={joining.isJoined}
          error={joining.error}
          onContinue={onJoined}
          onRetry={() => setJoining(null)}
        />
      ) : (
        <>
          <p className="text-muted">{t('wifi.scan_hint')}</p>
          <WifiScanView onRead={network => void join(network)} />
          <div className="search-dialog-actions">
            <button type="button" onClick={onClose} className="button button-secondary">
              {t('common.cancel')}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
