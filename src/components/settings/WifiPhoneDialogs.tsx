import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { wifiQrText } from '../../../pi/kiosk-audio/qr';
import { useLanguage } from '../../i18n/language';
import { useT } from '../../i18n/translate';
import type { StringId } from '../../i18n/strings';
import {
  hotspotStatus,
  phoneSetupStatus,
  startHotspot,
  startPhoneSetup,
  stopHotspot,
  stopPhoneSetup
} from '../../utils/kioskWifi';
import type { HotspotInfo, SetupStatus } from '../../utils/kioskWifi';
import Modal from '../Modal';
import QrCode from '../QrCode';

/** How often the dialogs ask the kiosk how the phone is getting on. */
export const SETUP_POLL_MS = 2000;
/** The page a phone sends the kiosk its network from, over Bluetooth (Improv Wi-Fi, in Chrome on Android). */
export const IMPROV_URL = 'https://www.improv-wifi.com/';

/** Where a dialog is: starting the setup, following it (with the kiosk's last word), or it could not start. */
type Progress = { state: 'starting' } | SetupStatus | { state: 'refused'; error: string | null };

const STATUS_WORDS: Readonly<Record<Progress['state'], StringId | null>> = {
  starting: 'wifi.starting',
  waiting: 'wifi.waiting_for_phone',
  joining: 'wifi.phone_joining',
  joined: null,
  failed: null,
  ended: 'wifi.setup_ended',
  refused: null
};

/**
 * Starts a setup from a phone and asks the kiosk where it is every couple of seconds until the phone's network is
 * joined (then `onJoined`), it failed, or it ended. `leave` stops a setup still under way, and resolves once the kiosk
 * has (the hotspot gives the radio back); unmounting first stops it too.
 */
function useSetup(
  start: () => Promise<true | string | null>,
  status: (signal: AbortSignal) => Promise<SetupStatus | undefined>,
  stop: () => Promise<void>,
  onJoined: () => void
): { progress: Progress; leave: () => Promise<void> } {
  const [progress, setProgress] = useState<Progress>({ state: 'starting' });
  const latest = useRef({ start, status, stop, onJoined });
  useEffect(() => {
    latest.current = { start, status, stop, onJoined };
  });
  // Whether the setup is over by itself (or never started), so there is nothing to stop.
  const isOver = useRef(false);
  // Whether the dialog is still up: a start that answers after it closed is stopped again.
  const isShown = useRef(false);
  const leave = useCallback(async () => {
    if (isOver.current) return;
    isOver.current = true;
    await latest.current.stop();
  }, []);
  useEffect(() => {
    isShown.current = true;
    isOver.current = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hasStarted = false;
    const follow = async () => {
      const answer = await latest.current.status(controller.signal);
      if (controller.signal.aborted) return;
      if (answer) setProgress(answer);
      if (answer?.state === 'joined' || answer?.state === 'failed' || answer?.state === 'ended') {
        isOver.current = true;
        if (answer.state === 'joined') latest.current.onJoined();
        return;
      }
      timer = setTimeout(() => void follow(), SETUP_POLL_MS);
    };
    void latest.current.start().then(started => {
      if (controller.signal.aborted) {
        // Closed while starting. When the dialog came straight back (React mounts it twice in development), its own
        // start was answered with this same setup, so only a dialog that is gone stops it.
        if (started === true && !isShown.current) void latest.current.stop();
        return;
      }
      if (started === true) {
        hasStarted = true;
        setProgress({ state: 'waiting' });
        timer = setTimeout(() => void follow(), SETUP_POLL_MS);
      } else {
        isOver.current = true;
        setProgress({ state: 'refused', error: started });
      }
    });
    return () => {
      isShown.current = false;
      controller.abort();
      clearTimeout(timer);
      if (hasStarted) void leave();
    };
  }, [leave]);
  return { progress, leave };
}

/** The kiosk's state as a line, and its error (or that it could not be reached) as an alert. */
function SetupProgress({ progress }: Readonly<{ progress: Progress }>) {
  const t = useT();
  const words = STATUS_WORDS[progress.state];
  let error: string | undefined;
  if (progress.state === 'refused') error = progress.error ?? t('wifi.unreachable');
  else if ('error' in progress) error = progress.error;
  return (
    <>
      {words !== null && (
        <p role="status" className="text-muted">
          {t(words)}
        </p>
      )}
      {error !== undefined && (
        <p role="alert" className="settings-error">
          {error}
        </p>
      )}
    </>
  );
}

function SetupDialog({
  title,
  onClose,
  children
}: Readonly<{ title: string; onClose: () => void; children: ReactNode }>) {
  const t = useT();
  const titleId = useId();
  return (
    <Modal
      labelledBy={titleId}
      onClose={onClose}
      className="app-modal-panel search-dialog wifi-setup border rounded-3xl p-6 shadow-2xl text-left select-none"
    >
      <div className="modal-header">
        <h3 id={titleId} className="text-lg font-semibold truncate">
          {title}
        </h3>
      </div>
      {children}
      <div className="search-dialog-actions">
        <button type="button" onClick={onClose} className="button button-secondary">
          {t('wifi.back')}
        </button>
      </div>
    </Modal>
  );
}

/**
 * `onJoined` once the kiosk is on the phone's network. `onClose` (Back) comes at once, with a promise that resolves when
 * the kiosk has stopped the setup: the hotspot has then given the radio back to the kiosk's own network.
 */
interface SetupDialogProps {
  onJoined: () => void;
  onClose: (stopped: Promise<void>) => void;
}

/**
 * From phone: the kiosk listens over Bluetooth for a few minutes for a phone to send it a network (Improv Wi-Fi, from
 * improv-wifi.com in Chrome on Android, which the code opens). Closes with `onJoined` once the kiosk is on it.
 */
export function WifiPhoneDialog({ onJoined, onClose }: Readonly<SetupDialogProps>) {
  const t = useT();
  const language = useLanguage();
  const { progress, leave } = useSetup(
    async () => {
      const result = await startPhoneSetup(language);
      return result.ok ? true : result.error;
    },
    signal => phoneSetupStatus(language, signal),
    stopPhoneSetup,
    onJoined
  );
  return (
    <SetupDialog title={t('wifi.from_phone')} onClose={() => onClose(leave())}>
      <div className="wifi-setup-body">
        <QrCode text={IMPROV_URL} label={t('wifi.qr_improv')} className="wifi-setup-qr" />
        <div className="wifi-setup-text">
          <p>{t('wifi.phone_steps')}</p>
          <SetupProgress progress={progress} />
        </div>
      </div>
    </SetupDialog>
  );
}

/**
 * Hotspot: the kiosk makes its own Wi-Fi for a few minutes. The first code joins it (its name and password are there to
 * type too), and the phone then gets a page to choose the kiosk's network on, which the second code opens when the phone
 * does not by itself. Closes with `onJoined` once the kiosk is on that network.
 */
export function WifiHotspotDialog({ onJoined, onClose }: Readonly<SetupDialogProps>) {
  const t = useT();
  const language = useLanguage();
  const [info, setInfo] = useState<HotspotInfo | null>(null);
  const { progress, leave } = useSetup(
    async () => {
      const result = await startHotspot(language);
      if (!result.ok) return result.error;
      setInfo(result.info);
      return true;
    },
    signal => hotspotStatus(language, signal),
    stopHotspot,
    onJoined
  );
  return (
    <SetupDialog title={t('wifi.hotspot')} onClose={() => onClose(leave())}>
      {info && (
        <div className="wifi-hotspot-codes">
          <figure className="wifi-hotspot-code">
            <QrCode text={wifiQrText(info.ssid, info.password)} label={t('wifi.qr_join')} className="wifi-setup-qr" />
            <figcaption>{t('wifi.scan_to_join')}</figcaption>
          </figure>
          <figure className="wifi-hotspot-code">
            <QrCode text={info.url} label={t('wifi.qr_open')} className="wifi-setup-qr" />
            <figcaption>{t('wifi.scan_to_open')}</figcaption>
          </figure>
          <dl className="wifi-hotspot-login">
            <dt>{t('wifi.name')}</dt>
            <dd data-testid="hotspot-name">{info.ssid}</dd>
            <dt>{t('wifi.password')}</dt>
            <dd data-testid="hotspot-password">{info.password}</dd>
          </dl>
        </div>
      )}
      <SetupProgress progress={progress} />
    </SetupDialog>
  );
}
