import { Check, LoaderCircle } from 'lucide-react';
import { useT } from '../../i18n/translate';

/** Stands in for the network's name in a line, which is then set in bold where it stood. */
const NAME_MARK = '\u{E000}';

/**
 * How joining the network read from a QR code is going, once the camera has done its part: a spinner and "Connecting
 * to" its name, which turn into a tick and "Successfully connected to" with Continue. Continue is there from the start,
 * unseen, so nothing shifts when the kiosk has joined. A network the kiosk could not join gets its reason (`error`) and
 * Try again.
 */
export default function WifiJoinProgress({
  ssid,
  isJoined,
  error,
  onContinue,
  onRetry
}: Readonly<{
  ssid: string;
  isJoined: boolean;
  error?: string | undefined;
  onContinue: () => void;
  onRetry: () => void;
}>) {
  const t = useT();
  if (error !== undefined) {
    return (
      <div className="wifi-join-progress">
        <p role="alert" className="settings-error status-danger">
          {error}
        </p>
        <button type="button" className="button search-dialog-confirm wifi-join-progress-button" onClick={onRetry}>
          {t('common.try_again')}
        </button>
      </div>
    );
  }
  const [before = '', after = ''] = t(isJoined ? 'wifi.scan_connected' : 'wifi.connecting', { ssid: NAME_MARK }).split(
    NAME_MARK
  );
  return (
    <div className="wifi-join-progress">
      <span className="wifi-join-progress-mark">
        {isJoined ? <Check aria-hidden="true" /> : <LoaderCircle className="animate-spin" aria-hidden="true" />}
      </span>
      <p className="wifi-join-progress-line" role="status">
        {before}
        <b>{ssid}</b>
        {after}
      </p>
      <button
        type="button"
        className={`button search-dialog-confirm wifi-join-progress-button${isJoined ? '' : ' invisible'}`}
        disabled={!isJoined}
        onClick={onContinue}
      >
        {t('common.continue')}
      </button>
    </div>
  );
}
