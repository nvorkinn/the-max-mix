import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/translate';
import { CAMERA_STREAM } from '../../utils/kioskCamera';
import { parseWifiQr } from '../../utils/wifiQr';
import type { WifiQr } from '../../utils/wifiQr';

/** How often the picture is searched for a code. */
const SCAN_MS = 400;
/** A code that is no use is not read again for this long, so its message stays readable. */
const RETRY_MS = 10_000;

/** A network read from a code that the kiosk can join: an open one, or one with a password. */
export type ReadNetwork = WifiQr & { security: 'open' | 'psk' };

/**
 * What the kiosk's camera sees, searched a few times a second for the QR code a phone shows to share its Wi-Fi network.
 * Mirrored, so that moving the phone moves the picture the same way. The camera is on only while this is shown.
 *
 * The first network read is handed to `onRead`, and the looking stops: whoever shows this joins it and says how that
 * went (WifiJoinProgress). A code that is not a Wi-Fi code, or names a network the kiosk cannot join, is said so under
 * the picture, and the looking goes on.
 */
export default function WifiScanView({ onRead }: Readonly<{ onRead: (network: ReadNetwork) => void }>) {
  const t = useT();
  const pictureRef = useRef<HTMLImageElement>(null);
  const [note, setNote] = useState<{ kind: 'status' | 'alert'; text: string } | null>(null);
  const tRef = useRef(t);
  const onReadRef = useRef(onRead);
  useEffect(() => {
    tRef.current = t;
    onReadRef.current = onRead;
  });

  useEffect(() => {
    const picture = pictureRef.current;
    if (!picture) return;
    const canvas = document.createElement('canvas');
    let isBusy = false;
    let isOver = false;
    let refused: { text: string; until: number } | null = null;

    const read = (text: string) => {
      const say = tRef.current;
      const network = parseWifiQr(text);
      if (network === null || network.security === 'unsupported') {
        setNote({ kind: 'alert', text: say(network === null ? 'wifi.scan_not_wifi' : 'wifi.scan_unsupported') });
        refused = { text, until: Date.now() + RETRY_MS };
        return;
      }
      isOver = true;
      onReadRef.current({ ...network, security: network.security });
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
        if (text !== null && !isRefused && !isOver) read(text);
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
    <>
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
    </>
  );
}
