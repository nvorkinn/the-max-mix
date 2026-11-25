import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AudioLines, Bluetooth, Check, KeyRound, LoaderCircle, UserRound, Wifi } from 'lucide-react';
import {
  deviceCredentials,
  deviceSecret,
  finishSetup,
  pairingPageUrl,
  pairingToken
} from '../../countdown/registration';
import { countdownServer } from '../../countdown/server';
import { usePhonePairing } from '../../hooks/usePhonePairing';
import { usePhoneSignIn } from '../../hooks/usePhoneSignIn';
import { useScreenSleep } from '../../hooks/useScreenSleep';
import { useSoloistKey } from '../../hooks/useSoloistKey';
import { useT } from '../../i18n/translate';
import { peopleOnKiosk, takePhoneToPair } from '../../spotify/auth';
import type { PersonOnKiosk } from '../../spotify/auth';
import { isKiosk } from '../../utils/kiosk';
import { loadThemeColour } from '../../utils/themeColour';
import PersonFace from '../PersonFace';
import PhonePairingView, { PairPhoneSteps } from '../PhonePairingView';
import QrCode from '../QrCode';
import SpotifyIcon from '../SpotifyIcon';
import { useWifi } from '../settings/wifi';
import WifiSettings from '../settings/WifiSettings';
import { useRegistration } from './useRegistration';

/** How often the Wi-Fi chapter asks the Pi which network it is on, so it moves on once the Pi has joined one. */
export const NETWORK_POLL_MS = 3000;

const CHAPTERS = ['wifi', 'account', 'spotify', 'soloist', 'presence'] as const;
type Chapter = (typeof CHAPTERS)[number];

const CHAPTER_ICONS: Record<Chapter, ReactNode> = {
  wifi: <Wifi className="w-6 h-6 shrink-0" aria-hidden="true" />,
  account: <UserRound className="w-6 h-6 shrink-0" aria-hidden="true" />,
  spotify: <SpotifyIcon className="w-6 h-6 shrink-0" />,
  soloist: <KeyRound className="w-6 h-6 shrink-0" aria-hidden="true" />,
  presence: <Bluetooth className="w-6 h-6 shrink-0" aria-hidden="true" />
};

const reloadPage = () => location.reload();

/** The settings site's pairing page with this kiosk's token: the one QR code for Account, Spotify and Soloist. */
function useSetupAddress(): string | null {
  const [address, setAddress] = useState<string | null>(null);
  useEffect(() => {
    const server = countdownServer();
    if (!server) return;
    let isCurrent = true;
    void pairingToken(deviceSecret()).then(token => {
      if (isCurrent) setAddress(pairingPageUrl(server, token));
    });
    return () => {
      isCurrent = false;
    };
  }, []);
  return address;
}

/**
 * Starts the Spotify sign-in that the owner's phone is sent on to once the kiosk is theirs (countdown-server's
 * /device/setup), and finishes it here when the phone is back. Its own QR code isn't shown: the setup code covers it.
 */
function SpotifySignIn({ onSignedIn }: Readonly<{ onSignedIn: () => void }>) {
  usePhoneSignIn(onSignedIn);
  return null;
}

/** The Presence chapter: what to do on the phone, then (once OK'd) the phones the Pi hears, then Done. */
function Presence({
  person,
  isPaired,
  onPaired,
  onDone
}: Readonly<{ person: PersonOnKiosk; isPaired: boolean; onPaired: () => void; onDone: () => void }>) {
  const t = useT();
  const [isLooking, setIsLooking] = useState(false);
  const { pairing, error, pick, retry } = usePhonePairing(person.spotifyId, isLooking && !isPaired);
  const justPaired = pairing.state === 'paired';
  useEffect(() => {
    if (justPaired) onPaired();
  }, [justPaired, onPaired]);
  if (isPaired) {
    return (
      <div className="setup-wizard-center">
        <div className="pair-phone-face">
          <PersonFace name={person.name} imageUrl={person.imageUrl} className="pair-phone-face-picture" />
          <Check className="pair-phone-face-tick" aria-hidden="true" />
        </div>
        <button type="button" className="button search-dialog-confirm setup-wizard-button" onClick={onDone}>
          {t('common.done')}
        </button>
      </div>
    );
  }
  if (!isLooking) {
    return (
      <div className="setup-wizard-center">
        <PairPhoneSteps />
        <button
          type="button"
          className="button search-dialog-confirm setup-wizard-button"
          onClick={() => setIsLooking(true)}
        >
          {t('common.ok')}
        </button>
      </div>
    );
  }
  if (error) {
    return (
      <div className="setup-wizard-center">
        <p role="alert" className="settings-error status-danger">
          {error}
        </p>
        <button type="button" className="button search-dialog-confirm setup-wizard-button" onClick={retry}>
          {t('common.try_again')}
        </button>
      </div>
    );
  }
  return (
    <div className="setup-wizard-presence">
      <PhonePairingView pairing={pairing} onPick={pick} />
    </div>
  );
}

/**
 * A new kiosk's first-time setup, over the whole app, laid out like Settings: the chapters down the left, each ticked
 * once it is done, and the current one on the right. It can't be left half done.
 *
 * - Wi-Fi: every way to join a network (Settings › Wi-Fi's page). It moves on once the Pi is on one.
 * - Account, Spotify and Soloist share one QR code, of countdown-server's pairing page. The owner scans it once and
 *   their phone goes through all three (countdown-server's /device/setup): signing in to Countdown makes the kiosk
 *   theirs, then Spotify signs them in, then they save their Soloist key. Meanwhile the kiosk registers and waits for
 *   an owner, then starts the Spotify sign-in, then asks for the key code, and ticks each chapter as it lands.
 * - Presence: the phone is paired over Bluetooth, the scan starting only once they have Bluetooth open and tap OK.
 *
 * Pairing and signing in reload the page, so every chapter's state is read from what the kiosk keeps. Done marks the
 * setup finished and opens the app.
 */
export default function SetupWizard({ onFinished = reloadPage }: Readonly<{ onFinished?: () => void }>) {
  const t = useT();
  // The screen stays on throughout: the Pi turns it off seconds after the last touch otherwise, mid-scan.
  useScreenSleep({ enabled: isKiosk(), keepAwake: true, onDashboard: false, sleepMs: null, quiet: false });
  const [registered] = useState(() => deviceCredentials() !== null);
  const [wifiDone, setWifiDone] = useState(registered);
  const [wifi, recheckWifi] = useWifi(!wifiDone);
  // Off the Pi's service (it can't say), there is no Wi-Fi to set up here.
  if (!wifiDone && ((wifi.state === 'connected' && wifi.address !== null) || wifi.state === 'unknown')) {
    setWifiDone(true);
  }
  // The Pi may join a saved network by itself (as at boot) while the chapter is open.
  useEffect(() => {
    if (wifiDone) return;
    const timer = setInterval(recheckWifi, NETWORK_POLL_MS);
    return () => clearInterval(timer);
  }, [wifiDone, recheckWifi]);

  const [people] = useState(peopleOnKiosk);
  const person = people.find(someone => someone.active) ?? people[0];
  const key = useSoloistKey(person?.spotifyId ?? '', registered && person !== undefined);
  const [phonePaired, setPhonePaired] = useState(person !== undefined && person.phoneAddress !== '');
  const markPaired = useCallback(() => setPhonePaired(true), []);
  const address = useSetupAddress();

  const done: Record<Chapter, boolean> = {
    wifi: wifiDone,
    account: registered,
    spotify: person !== undefined,
    soloist: key === 'saved',
    presence: phonePaired
  };
  const current = CHAPTERS.find(chapter => !done[chapter]) ?? 'presence';
  useRegistration(wifiDone && !registered, reloadPage);

  const finish = () => {
    // The sign-in left word to offer pairing their phone, which this has done.
    takePhoneToPair();
    finishSetup();
    onFinished();
  };

  let page: ReactNode;
  if (current === 'wifi') {
    page = <WifiSettings wifi={wifi} onJoined={recheckWifi} />;
  } else if (current === 'presence' && person) {
    page = <Presence person={person} isPaired={phonePaired} onPaired={markPaired} onDone={finish} />;
  } else {
    page = (
      <div className="setup-wizard-center">
        {current === 'spotify' && <SpotifySignIn onSignedIn={reloadPage} />}
        {address ? (
          <QrCode text={address} className="setup-wizard-code" label={t('pairing.code')} />
        ) : (
          <LoaderCircle className="w-10 h-10 animate-spin text-accent" aria-hidden="true" />
        )}
      </div>
    );
  }

  return (
    <div className="tablet-container" data-colour={loadThemeColour()}>
      <main
        className="app-modal-panel settings-panel setup-wizard text-left select-none"
        aria-label={t('pairing.title')}
      >
        <nav className="settings-nav" aria-label={t('pairing.title')}>
          <div className="setup-wizard-brand">
            <span className="setup-wizard-mark" aria-hidden="true">
              <AudioLines className="lucide" />
            </span>
            <span className="setup-wizard-name">The Max Mix.</span>
          </div>
          <ol className="settings-nav-list">
            {CHAPTERS.map(chapter => (
              <li
                key={chapter}
                aria-current={chapter === current ? 'step' : undefined}
                className={`settings-nav-item setup-wizard-chapter${done[chapter] ? ' is-done' : ''}`}
              >
                {done[chapter] ? <Check className="w-6 h-6 shrink-0" aria-hidden="true" /> : CHAPTER_ICONS[chapter]}
                <span className="truncate">{t(`setup.chapter_${chapter}`)}</span>
              </li>
            ))}
          </ol>
        </nav>
        <section className="settings-content" aria-label={t(`setup.chapter_${current}`)}>
          <div className="settings-content-body setup-wizard-body" key={current}>
            <h2 className="setup-wizard-title">{t(`setup.chapter_${current}`)}</h2>
            {page}
          </div>
        </section>
      </main>
    </div>
  );
}
