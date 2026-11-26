import { useId } from 'react';
import { useT } from '../../i18n/translate';
import Modal from '../Modal';
import WifiScanView from './WifiScanView';

/**
 * Settings > Wi-Fi's Scan code: joins the network whose QR code is held up to the kiosk's camera (WifiScanView). Closes
 * with `onJoined` once the kiosk is on it.
 */
export default function WifiScanDialog({ onJoined, onClose }: Readonly<{ onJoined: () => void; onClose: () => void }>) {
  const t = useT();
  const titleId = useId();
  return (
    <Modal
      labelledBy={titleId}
      onClose={onClose}
      className="app-modal-panel wifi-scan border rounded-3xl p-6 shadow-2xl text-left select-none"
    >
      <div className="modal-header">
        <h3 id={titleId} className="text-lg font-semibold truncate">
          {t('wifi.scan_title')}
        </h3>
      </div>
      <p className="text-muted">{t('wifi.scan_hint')}</p>
      <WifiScanView onJoined={onJoined} />
      <div className="search-dialog-actions">
        <button type="button" onClick={onClose} className="button button-secondary">
          {t('common.cancel')}
        </button>
      </div>
    </Modal>
  );
}
