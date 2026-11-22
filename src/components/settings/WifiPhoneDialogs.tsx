import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { wifiQrText } from '../../../pi/kiosk-audio/qr';
import { useLanguage } from '../../i18n/language';
import { useT } from '../../i18n/translate';
import type { StringId } from '../../i18n/strings';
import { hotspotStatus, startHotspot, stopHotspot } from '../../utils/kioskWifi';
import type { HotspotInfo, SetupStatus } from '../../utils/kioskWifi';
import Modal from '../Modal';
import QrCode from '../QrCode';

/** How often the dialogs ask the kiosk how the phone is getting on. */
export const SETUP_POLL_MS = 2000;

/** Where a dialog is: starting the setup, following it (with the kiosk's last word), or it could not start. */
type Progress = SetupStatus | { state: 'starting' } | { state: 'refused'; error: string | null };

type StatusWords = Readonly<Record<Progress['state'], StringId | null>>;

const STATUS_WORDS: StatusWords = {
  starting: 'wifi.starting',
  waiting: 'wifi.waiting_for_phone',
  connected: 'wifi.waiting_for_phone',
  joining: 'wifi.phone_joining',
  joined: null,
  failed: null,
  ended: null,
  refused: null
};
// The Hotspot dialog's steps say what it waits for, and step 2 which network it joins, so only starting gets a line.
const HOTSPOT_WORDS: StatusWords = { ...STATUS_WORDS, waiting: null, connected: null, joining: null };

/**
 * Starts a setup from a phone and asks the kiosk where it is every couple of seconds until the phone's network is
 * joined, it failed, or it ended (then `onEnd`, which closes the dialog). `leave` stops a setup still under way, and resolves once the kiosk
 * has (the hotspot gives the radio back); unmounting first stops it too.
 */
function useSetup(
  start: () => Promise<true | string | null>,
  status: (signal: AbortSignal) => Promise<SetupStatus | undefined>,
  stop: () => Promise<void>,
  onEnd: (end: SetupEnd) => void
): { progress: Progress; leave: () => Promise<void> } {
  const [progress, setProgress] = useState<Progress>({ state: 'starting' });
  const latestRef = useRef({ start, status, stop, onEnd });
  useEffect(() => {
    latestRef.current = { start, status, stop, onEnd };
  });
  // Whether the setup is over by itself (or never started), so there is nothing to stop.
  const isOverRef = useRef(false);
  // Whether the dialog is still up: a start that answers after it closed is stopped again.
  const isShownRef = useRef(false);
  const leave = useCallback(async () => {
    if (isOverRef.current) return;
    isOverRef.current = true;
    await latestRef.current.stop();
  }, []);
  useEffect(() => {
    isShownRef.current = true;
    isOverRef.current = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hasStarted = false;
    const follow = async () => {
      const answer = await latestRef.current.status(controller.signal);
      if (controller.signal.aborted) return;
      if (answer) setProgress(answer);
      if (answer?.state === 'joined' || answer?.state === 'failed' || answer?.state === 'ended') {
        isOverRef.current = true;
        latestRef.current.onEnd(answer.state === 'joined' ? { joined: true } : { joined: false, error: answer.error });
        return;
      }
      timer = setTimeout(() => void follow(), SETUP_POLL_MS);
    };
    void latestRef.current.start().then(started => {
      if (controller.signal.aborted) {
        // Closed while starting. When the dialog came straight back (React mounts it twice in development), its own
        // start was answered with this same setup, so only a dialog that is gone stops it.
        if (started === true && !isShownRef.current) void latestRef.current.stop();
        return;
      }
      if (started === true) {
        hasStarted = true;
        setProgress({ state: 'waiting' });
        timer = setTimeout(() => void follow(), SETUP_POLL_MS);
      } else {
        isOverRef.current = true;
        setProgress({ state: 'refused', error: started });
      }
    });
    return () => {
      isShownRef.current = false;
      controller.abort();
      clearTimeout(timer);
      if (hasStarted) void leave();
    };
  }, [leave]);
  return { progress, leave };
}

/** The kiosk's state as a line, and its error (or that it could not be reached) as an alert. */
function SetupProgress({
  progress,
  words: wordsFor = STATUS_WORDS
}: Readonly<{ progress: Progress; words?: StatusWords }>) {
  const t = useT();
  const words = wordsFor[progress.state];
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
  className = '',
  onClose,
  children
}: Readonly<{ title: string; className?: string; onClose: () => void; children: ReactNode }>) {
  const t = useT();
  const titleId = useId();
  return (
    <Modal
      labelledBy={titleId}
      onClose={onClose}
      className={`app-modal-panel search-dialog wifi-setup ${className} border rounded-3xl p-6 shadow-2xl text-left select-none`}
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

/** How a setup ended by itself: the phone's network joined, or not (with the kiosk's reason, when it gave one). */
export type SetupEnd = { joined: false; error?: string | undefined } | { joined: true };

/**
 * `onEnd` once the setup is over by itself: the kiosk joined the phone's network, could not, or the setup's minutes ran
 * out. `onClose` (Back) comes at once, with a promise that resolves when the kiosk has stopped the setup: the hotspot has
 * then given the radio back to the kiosk's own network.
 */
interface SetupDialogProps {
  onEnd: (end: SetupEnd) => void;
  onClose: (stopped: Promise<void>) => void;
}

/**
 * Hotspot, in two numbered steps, one open at a time so a camera cannot read the wrong code. Step 1: the kiosk's own
 * Wi-Fi for a few minutes, its code to join it, and its name and password to type. Step 2, once a phone is on it: the
 * code that opens the page to choose the kiosk's network on, for a phone that does not open it by itself. The step not
 * open shows only its heading, so the move from one to the other is plain.
 */
export function WifiHotspotDialog({ onEnd, onClose }: Readonly<SetupDialogProps>) {
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
    onEnd
  );
  const isPhoneOn = progress.state === 'connected' || progress.state === 'joining';
  return (
    <SetupDialog title={t('wifi.hotspot')} className="wifi-hotspot" onClose={() => onClose(leave())}>
      {info && (
        <ol className="wifi-hotspot-steps">
          <HotspotStep
            number={1}
            title={t(isPhoneOn ? 'wifi.step_joined' : 'wifi.step_join')}
            isOpen={!isPhoneOn}
            isDone={isPhoneOn}
          >
            <QrCode text={wifiQrText(info.ssid, info.password)} label={t('wifi.qr_join')} className="wifi-setup-qr" />
            <dl className="wifi-hotspot-login">
              <dt>{t('wifi.name')}</dt>
              <dd data-testid="hotspot-name">{info.ssid}</dd>
              <dt>{t('wifi.password')}</dt>
              <dd data-testid="hotspot-password">{info.password}</dd>
            </dl>
          </HotspotStep>
          <HotspotStep number={2} title={t('wifi.step_open')} isOpen={isPhoneOn} isDone={false}>
            <QrCode text={info.url} label={t('wifi.qr_open')} className="wifi-setup-qr" />
            {progress.state === 'joining' && progress.ssid !== undefined && (
              <p className="wifi-hotspot-joining" role="status">
                <LoaderCircle className="wifi-hotspot-joining-spinner animate-spin" aria-hidden="true" />
                <span className="wifi-hotspot-joining-name" data-testid="hotspot-joining">
                  {progress.ssid}
                </span>
              </p>
            )}
          </HotspotStep>
        </ol>
      )}
      <SetupProgress progress={progress} words={HOTSPOT_WORDS} />
    </SetupDialog>
  );
}

/** One of the Hotspot dialog's steps: its number (a tick once done) and title, and what to do while it is open. */
function HotspotStep({
  number,
  title,
  isOpen,
  isDone,
  children
}: Readonly<{ number: number; title: string; isOpen: boolean; isDone: boolean; children: ReactNode }>) {
  return (
    <li className="wifi-hotspot-step" data-open={isOpen} aria-current={isOpen ? 'step' : undefined}>
      <h4 className="wifi-hotspot-step-title">
        <span className="wifi-hotspot-step-number" aria-hidden="true">
          {isDone ? <Check className="lucide" /> : number}
        </span>
        {title}
      </h4>
      {isOpen && <div className="wifi-hotspot-step-body">{children}</div>}
    </li>
  );
}
