import { useEffect, useId, useRef, useState } from 'react';
import { useLanguage } from '../../i18n/language';
import { useT } from '../../i18n/translate';
import { CAMERA_STREAM } from '../../utils/kioskCamera';
import { joinWifi } from '../../utils/kioskWifi';
import { parseWifiQr } from '../../utils/wifiQr';
import Modal from '../Modal';

/** How often the picture is searched for a code. */
const SCAN_MS = 400;
/** A code the kiosk could not join is not tried again for this long, so its message stays readable. */
const RETRY_MS = 10_000;

/**
 * Joins the Wi-Fi network whose QR code is held up to the kiosk's camera, the code a phone shows to share its network.
 * Shows what the camera sees, mirrored so that moving the phone moves the picture the same way, and searches it for a
 * code a few times a second. Closes with `onJoined` once the kiosk is on the network; says the kiosk's reason when it
 * is not, and keeps looking. The camera is on only while the dialog is open.
 */
export default function WifiScanDialog({ onJoined, onClose }: Readonly<{ onJoined: () => void; onClose: () => void }>) {
  const t = useT();
  const language = useLanguage();
  const titleId = useId();
  const pictureRef = useRef<HTMLImageElement>(null);
  const [note, setNote] = useState<{ kind: 'status' | 'alert'; text: string } | null>(null);
  const tRef = useRef(t);
  const languageRef = useRef(language);
  const onJoinedRef = useRef(onJoined);
  useEffect(() => {
    tRef.current = t;
    languageRef.current = language;
    onJoinedRef.current = onJoined;
  });

  useEffect(() => {
    const picture = pictureRef.current;
    if (!picture) return;
    const canvas = document.createElement('canvas');
    let isBusy = false;
    let isOver = false;
    let refused: { text: string; until: number } | null = null;

    const join = async (text: string) => {
      const say = tRef.current;
      const network = parseWifiQr(text);
      if (network === null || network.security === 'unsupported') {
        setNote({ kind: 'alert', text: say(network === null ? 'wifi.scan_not_wifi' : 'wifi.scan_unsupported') });
        refused = { text, until: Date.now() + RETRY_MS };
        return;
      }
      setNote({ kind: 'status', text: say('wifi.connecting', { ssid: network.ssid }) });
      const result = await joinWifi({ ...network, security: network.security }, languageRef.current);
      if (isOver) return;
      if (result.ok) {
        onJoinedRef.current();
      } else {
        setNote({ kind: 'alert', text: result.error ?? say('wifi.unreachable') });
        refused = { text, until: Date.now() + RETRY_MS };
      }
    };

    const look = async () => {
      if (isBusy || picture.naturalWidth === 0) return;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return;
      isBusy = true;
      try {
        canvas.width = picture.naturalWidth;
        canvas.height = picture.naturalHeight;
        context.drawImage(picture, 0, 0);
        const { decodeQr } = await import('../../utils/qrDecode');
        const text = await decodeQr(context.getImageData(0, 0, canvas.width, canvas.height));
        const isRefused = refused !== null && refused.text === text && Date.now() < refused.until;
        if (text !== null && !isRefused && !isOver) await join(text);
      } catch {
        // A frame that could not be read; the next one may.
      } finally {
        isBusy = false;
      }
    };

    const timer = setInterval(() => void look(), SCAN_MS);
    return () => {
      isOver = true;
      clearInterval(timer);
      // Ends the request, which turns the camera off.
      picture.removeAttribute('src');
    };
  }, []);

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
      <img
        ref={pictureRef}
        src={CAMERA_STREAM}
        crossOrigin="anonymous"
        alt={t('wifi.scan_preview')}
        className="wifi-scan-picture"
        onError={() => setNote({ kind: 'alert', text: t('wifi.scan_no_camera') })}
      />
      {note !== null && (
        <p role={note.kind} className={note.kind === 'alert' ? 'settings-error' : 'text-muted'}>
          {note.text}
        </p>
      )}
      <div className="search-dialog-actions">
        <button type="button" onClick={onClose} className="button button-secondary">
          {t('common.cancel')}
        </button>
      </div>
    </Modal>
  );
}
