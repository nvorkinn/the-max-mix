import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../i18n/language';
import { useT } from '../../i18n/translate';
import { CAMERA_STREAM } from '../../utils/kioskCamera';
import { joinWifi } from '../../utils/kioskWifi';
import { parseWifiQr } from '../../utils/wifiQr';

/** How often the picture is searched for a code. */
const SCAN_MS = 400;
/** A code the kiosk could not join is not tried again for this long, so its message stays readable. */
const RETRY_MS = 10_000;

/**
 * What the kiosk's camera sees, searched a few times a second for the QR code a phone shows to share its Wi-Fi network;
 * the kiosk joins the network of the first one it reads. Mirrored, so that moving the phone moves the picture the same
 * way. Calls `onJoined` with the network's name once the kiosk is on it; says the kiosk's reason under the picture when it is not,
 * and keeps looking. The camera is on only while this is shown.
 */
export default function WifiScanView({ onJoined }: Readonly<{ onJoined: (ssid: string) => void }>) {
  const t = useT();
  const language = useLanguage();
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
        onJoinedRef.current(network.ssid);
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
