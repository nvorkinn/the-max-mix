import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AudioLines, Bluetooth, Check, KeyRound, LoaderCircle, MapPin, UserRound, Wifi } from 'lucide-react';
import type { SetupStep, SpotifySignIn as ServerSignIn } from 'countdown-api';
import { loadDeviceConfig } from '../../countdown/config';
import {
  deviceCredentials,
  deviceSecret,
  finishSetup,
  forgetSetupVerifier,
  pairingPageUrl,
  pairingToken
} from '../../countdown/registration';
import { countdownServer } from '../../countdown/server';
import { usePhonePairing } from '../../hooks/usePhonePairing';
import { usePhoneSignIn, useSetupSignIn } from '../../hooks/usePhoneSignIn';
import { useScreenSleep } from '../../hooks/useScreenSleep';
import { useSetupStatus } from '../../hooks/useSetupStatus';
import { useSoloistKey } from '../../hooks/useSoloistKey';
import { useSoloistSignIn } from '../../hooks/useSoloistSignIn';
import { useLanguage } from '../../i18n/language';
import { useT } from '../../i18n/translate';
import { peopleOnKiosk, takePhoneToPair } from '../../spotify/auth';
import type { PersonOnKiosk } from '../../spotify/auth';
import { isKiosk } from '../../utils/kiosk';
import { hasCamera } from '../../utils/kioskCamera';
import { joinWifi } from '../../utils/kioskWifi';
import { loadThemeColour } from '../../utils/themeColour';
import PersonFace from '../PersonFace';
import PhonePairingView from '../PhonePairingView';
import QrCode from '../QrCode';
import SpotifyIcon from '../SpotifyIcon';
import { useWifi } from '../settings/wifi';
import type { WifiState } from '../settings/wifi';
import WifiJoinProgress from '../settings/WifiJoinProgress';
import WifiScanView from '../settings/WifiScanView';
import type { ReadNetwork } from '../settings/WifiScanView';
import WifiSettings from '../settings/WifiSettings';
import OpenBluetooth from './OpenBluetooth';
import PickInSpotify from './PickInSpotify';
import ShareWifiCode from './ShareWifiCode';
import { useRegistration } from './useRegistration';

/** How often the Wi-Fi chapter asks the Pi which network it is on, so it moves on once the Pi has joined one. */
export const NETWORK_POLL_MS = 3000;
/** The kiosk counts as off its network once it has said so this many times running: one answer may be a blip. */
const LOST_AFTER = 2;
/** How long Done waits for the server to hear that the setup is finished before it opens the app anyway. */
export const FINISH_REPORT_MS = 2000;

const CHAPTERS = ['wifi', 'account', 'spotify', 'soloist', 'location', 'presence'] as const;
type Chapter = (typeof CHAPTERS)[number];

/** The chapter each of the server's steps is on: Soloist's key and its sign-in share one, and `done` ends the last. */
const STEP_CHAPTERS: Record<SetupStep, Chapter> = {
  account: 'account',
  spotify: 'spotify',
  soloist_key: 'soloist',
  soloist_sign_in: 'soloist',
  location: 'location',
  presence: 'presence',
  done: 'presence'
};

const CHAPTER_ICONS: Record<Chapter, ReactNode> = {
  wifi: <Wifi className="w-6 h-6 shrink-0" aria-hidden="true" />,
  account: <UserRound className="w-6 h-6 shrink-0" aria-hidden="true" />,
  spotify: <SpotifyIcon className="w-6 h-6 shrink-0" />,
  soloist: <KeyRound className="w-6 h-6 shrink-0" aria-hidden="true" />,
  location: <MapPin className="w-6 h-6 shrink-0" aria-hidden="true" />,
  presence: <Bluetooth className="w-6 h-6 shrink-0" aria-hidden="true" />
};

/** A network the camera's chapter read from its code, and whether Continue has been tapped once the kiosk is on it. */
interface ScannedNetwork {
  ssid: string;
  isConfirmed: boolean;
}

/** Stands in for a name in a line (the kiosk's, a network's), which is then set in bold where it stood. */
const DEVICE_MARK = '\u{E000}';
/** What a kiosk's player is called in Spotify until the Pi's service has said (server/src/soloist.ts). */
const KIOSK_NAME = 'The Max Mix';

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

const signedIn = () => {
  // The first person is signed in, so the verifier kept for it since the kiosk registered has done its work.
  forgetSetupVerifier();
  reloadPage();
};

/**
 * On a server that doesn't follow the setup: starts the Spotify sign-in that the owner's phone is sent on to once the
 * kiosk is theirs (countdown-server's /device/setup), and finishes it here when the phone is back. Its own QR code
 * isn't shown: the setup code covers it.
 */
function SpotifySignIn() {
  usePhoneSignIn(signedIn);
  return null;
}

/**
 * On a server that follows the setup: finishes the sign-in the server made for the phone from the challenge the kiosk
 * reported (useSetupSignIn), once the setup's status names it.
 */
function FollowedSignIn({ signIn }: Readonly<{ signIn: ServerSignIn | undefined }>) {
  useSetupSignIn(signIn, reloadPage);
  return null;
}

/** The end of the setup: the owner's face when there is one, that it is complete, and Done. */
function Complete({ person, onDone }: Readonly<{ person: PersonOnKiosk | undefined; onDone: () => void }>) {
  const t = useT();
  return (
    <div className="setup-wizard-center">
      {person && (
        <div className="pair-phone-face">
          <PersonFace name={person.name} imageUrl={person.imageUrl} className="pair-phone-face-picture" />
          <Check className="pair-phone-face-tick" aria-hidden="true" />
        </div>
      )}
      <p className="setup-wizard-complete">{t('setup.complete')}</p>
      <button type="button" className="button search-dialog-confirm setup-wizard-button" onClick={onDone}>
        {t('common.done')}
      </button>
    </div>
  );
}

function Waiting() {
  return (
    <div className="setup-wizard-center">
      <LoaderCircle className="w-10 h-10 animate-spin text-accent" aria-hidden="true" />
    </div>
  );
}

/**
 * A chapter done on the phone, which was sent on to it from the one before (Spotify, the Soloist key, Location): what
 * happens there, and that the kiosk is waiting. The setup code is not shown again, as if it had to be scanned again; it is
 * behind a small line at the bottom, for whoever lost the page on their phone.
 */
function OnPhone({ lead, address }: Readonly<{ lead: string; address: string | null }>) {
  const t = useT();
  const [isShowingCode, setIsShowingCode] = useState(false);
  return (
    <div className="setup-wizard-center">
      <p className="setup-wizard-lead">{lead}</p>
      {isShowingCode && address ? (
        <QrCode text={address} className="setup-wizard-code" label={t('pairing.code')} />
      ) : (
        <LoaderCircle className="w-10 h-10 animate-spin text-accent" aria-hidden="true" />
      )}
      {!isShowingCode && (
        <button type="button" className="setup-wizard-other" onClick={() => setIsShowingCode(true)}>
          {t('setup.show_code')}
        </button>
      )}
    </div>
  );
}

/**
 * The Soloist chapter once the key is saved: Soloist signs in to the person's Spotify account the first time they pick
 * the kiosk in Spotify on their phone, which the drawing shows. Until Soloist has said where it stands, only a spinner.
 */
function SpotifyPick({ device }: Readonly<{ device: string | null }>) {
  const t = useT();
  if (device === null) return <Waiting />;
  const [before = '', after = ''] = t('setup.pick_in_spotify', { device: DEVICE_MARK }).split(DEVICE_MARK);
  return (
    <div className="setup-wizard-center setup-wizard-pick">
      <p className="setup-wizard-lead">
        {before}
        <b>{device}</b>
        {after}
      </p>
      <PickInSpotify device={device} />
    </div>
  );
}

/**
 * The Wi-Fi chapter on a kiosk with a camera: how a phone shows its network as a QR code (an iPhone's way in the
 * drawing and the lead, Android's in the line under it), then (once OK'd) what the camera sees until it has read a
 * code. The page then changes at once, so nobody keeps holding their phone up: a spinner while the kiosk joins that
 * network (`scanned`), which turns into a tick with the network's name, and setup goes on at Continue. A network it
 * could not join gets the kiosk's reason and Try again, back at the camera. Every other way to join one (Settings ›
 * Wi-Fi's page) is behind the line at the bottom, and from there on the chapter stays on that page.
 */
function WifiByCamera({
  wifi,
  scanned,
  onJoined,
  onRead,
  onFailed,
  onContinue,
  onScanSetup
}: Readonly<{
  wifi: WifiState;
  scanned: ScannedNetwork | null;
  onJoined: () => void;
  onRead: (ssid: string) => void;
  onFailed: () => void;
  onContinue: () => void;
  /** Whether the other page's Scan code dialog is open, which says how its own join went before the chapter ends. */
  onScanSetup: (isActive: boolean) => void;
}>) {
  const t = useT();
  const language = useLanguage();
  const [step, setStep] = useState<'show' | 'scan' | 'other'>('show');
  const [joining, setJoining] = useState<{ isJoined: boolean; error?: string }>({ isJoined: false });
  // Continue is tapped; the Pi may still be getting its address.
  if (scanned?.isConfirmed) return <Waiting />;
  if (scanned) {
    return (
      <div className="setup-wizard-center">
        <WifiJoinProgress
          ssid={scanned.ssid}
          isJoined={joining.isJoined}
          error={joining.error}
          onContinue={onContinue}
          onRetry={onFailed}
        />
      </div>
    );
  }
  if (step === 'other') return <WifiSettings wifi={wifi} onJoined={onJoined} onScanSetup={onScanSetup} />;
  const join = async (network: ReadNetwork) => {
    onRead(network.ssid);
    setJoining({ isJoined: false });
    const result = await joinWifi(network, language);
    if (result.ok) {
      setJoining({ isJoined: true });
      onJoined();
    } else {
      setJoining({ isJoined: false, error: result.error ?? t('wifi.unreachable') });
    }
  };
  return (
    <div className="setup-wizard-center setup-wizard-wifi">
      <p className="setup-wizard-lead">
        {t(step === 'show' ? 'setup.wifi_show' : 'setup.wifi_hold')}
        {step === 'show' && <span className="setup-wizard-aside">{t('setup.wifi_show_android')}</span>}
      </p>
      {step === 'show' ? (
        <>
          <ShareWifiCode />
          <button
            type="button"
            className="button search-dialog-confirm setup-wizard-button"
            onClick={() => setStep('scan')}
          >
            {t('common.ok')}
          </button>
        </>
      ) : (
        <div className="setup-wizard-camera">
          <WifiScanView onRead={network => void join(network)} />
        </div>
      )}
      <button type="button" className="setup-wizard-other" onClick={() => setStep('other')}>
        {t('setup.wifi_other')}
      </button>
    </div>
  );
}

/**
 * The Presence chapter: what to do on the phone, with a drawing of it, then (once OK'd) the phones the Pi hears, then
 * Done.
 */
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
  if (isPaired) return <Complete person={person} onDone={onDone} />;
  if (!isLooking) {
    return (
      <div className="setup-wizard-center">
        <p className="setup-wizard-lead">
          {t('setup.presence')}
          <span className="setup-wizard-aside">{t('setup.presence_open')}</span>
        </p>
        <OpenBluetooth />
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
      <PhonePairingView pairing={pairing} onPick={pick}>
        <p className="setup-wizard-lead">{t('setup.presence_pick')}</p>
      </PhonePairingView>
    </div>
  );
}

/**
 * A new kiosk's first-time setup, over the whole app, laid out like Settings: the chapters down the left, each ticked
 * once it is done, and the current one on the right. It can't be left half done.
 *
 * - Wi-Fi: on a kiosk with a camera, showing it the QR code a phone shares its network with; otherwise, or from the
 *   line under that, every way to join a network (Settings › Wi-Fi's page). It moves on once the Pi is on one.
 *   Setup comes back to it if the kiosk loses its network before Presence.
 * - Account, Spotify, Soloist and Location share one QR code, of countdown-server's pairing page. The owner scans it
 *   once, on Account; the others only say what happens on the phone, with the code behind a line for whoever lost the
 *   page (OnPhone). Their phone then goes through all of them: signing in to Countdown makes the kiosk theirs, then
 *   Spotify signs them in, then they save their Soloist key, then they say where the kiosk is.
 * - Soloist has a second page: the key only starts it, and it signs in to their Spotify account the first time they
 *   pick the kiosk in Spotify's device list on their phone.
 * - Location is done on the phone alone, which knows where it is: the postcode, which sets the notice board and the
 *   weather, and the stops near it for the Countdown, or Skip, which leaves all of it for Settings.
 * - Presence: the phone is paired over Bluetooth, the scan starting only once they have Bluetooth open and tap OK.
 *
 * The kiosk and the phone show the same step, because both ask countdown-server where the setup stands
 * (useSetupStatus): once someone owns the kiosk, the chapter is the server's step, and the kiosk tells the server what
 * only it knows (what its Soloist is called and that it has signed in, that the phone is paired, that Done was
 * tapped). On Spotify the server makes the sign-in itself, from the challenge the kiosk reported when it registered,
 * and the kiosk finishes it with the verifier it kept (useSetupSignIn), then asks for the person's Soloist key code,
 * which is what moves the step on. Wi-Fi stays the kiosk's own business, as the phone has no part in it.
 *
 * A server that doesn't follow setups (one from before it did) leaves the kiosk to go by what it knows itself, as it
 * always did: it starts the Spotify sign-in, ticks each chapter as it lands, and says that Soloist is set up before
 * Presence opens at Continue. There is then no Location chapter: the owner sets that in Settings.
 *
 * Pairing and signing in reload the page, so every chapter's state is read from what the kiosk keeps and what the
 * server says. Done marks the setup finished and opens the app.
 */
export default function SetupWizard({ onFinished = reloadPage }: Readonly<{ onFinished?: () => void }>) {
  const t = useT();
  // The screen stays on throughout: the Pi turns it off seconds after the last touch otherwise, mid-scan.
  useScreenSleep({ enabled: isKiosk(), keepAwake: true, onDashboard: false, sleepMs: null, quiet: false });
  const [registered] = useState(() => deviceCredentials() !== null);
  // A kiosk nobody owns yet opens on the welcome, which says what is coming; once owned (the page reloads on the way),
  // it goes straight to the chapter it is on.
  const [isWelcoming, setIsWelcoming] = useState(!registered);
  const [wifiDone, setWifiDone] = useState(registered);
  // Asked all through setup, not just in its chapter: the chapters after it need the network too.
  const [wifi, recheckWifi] = useWifi(true);
  // How many answers in a row said the kiosk is on no network.
  const [answer, setAnswer] = useState(wifi);
  const [missed, setMissed] = useState(0);
  if (answer !== wifi) {
    setAnswer(wifi);
    setMissed(wifi.state === 'disconnected' ? missed + 1 : 0);
  }
  // A network read from its code by the camera is joined and named on a page of its own; the chapter ends at Continue.
  const [scanned, setScanned] = useState<ScannedNetwork | null>(null);
  const [isScanDialogOpen, setIsScanDialogOpen] = useState(false);
  const isWaitingForContinue = (scanned !== null && !scanned.isConfirmed) || isScanDialogOpen;
  // Off the Pi's service (it can't say), there is no Wi-Fi to set up here.
  if (
    !wifiDone &&
    !isWaitingForContinue &&
    ((wifi.state === 'connected' && wifi.address !== null) || wifi.state === 'unknown')
  ) {
    setWifiDone(true);
  }
  // The Pi may join a saved network by itself (as at boot) while the chapter is open, or lose its network later on.
  useEffect(() => {
    const timer = setInterval(recheckWifi, NETWORK_POLL_MS);
    return () => clearInterval(timer);
  }, [recheckWifi]);

  // Undefined until the Pi's service has said whether the screen has a camera, which decides how the chapter opens.
  const [hasKioskCamera, setHasKioskCamera] = useState<boolean | undefined>();
  useEffect(() => {
    if (wifiDone) return;
    const controller = new AbortController();
    void hasCamera(controller.signal).then(found => {
      if (!controller.signal.aborted) setHasKioskCamera(found);
    });
    return () => controller.abort();
  }, [wifiDone]);

  const [people] = useState(peopleOnKiosk);
  const person = people.find(someone => someone.active) ?? people[0];
  const key = useSoloistKey(person?.spotifyId ?? '', registered && person !== undefined);
  // The key starts Soloist; it is signed in once they have picked the kiosk in Spotify on their phone.
  const [soloistSignedIn, setSoloistSignedIn] = useState(false);
  const soloist = useSoloistSignIn(key === 'saved' && !soloistSignedIn);
  if (!soloistSignedIn && soloist.isSignedIn === true) setSoloistSignedIn(true);
  // Soloist was seen being set up here (its key still to come, or it still to be signed in), not found done already:
  // then the chapter says that it is done, and goes on to Presence at Continue, not under the phone in their hand.
  const [soloistWaited, setSoloistWaited] = useState(false);
  const isSoloistWaiting =
    (key !== 'saved' && key !== 'unavailable') || (key === 'saved' && soloist.isSignedIn === false);
  if (!soloistWaited && isSoloistWaiting) setSoloistWaited(true);
  const [soloistAcknowledged, setSoloistAcknowledged] = useState(false);
  const isSoloistSet = key === 'saved' && soloistSignedIn;
  const isSayingSoloistSet = isSoloistSet && soloistWaited && !soloistAcknowledged;
  const [phonePaired, setPhonePaired] = useState(person !== undefined && person.phoneAddress !== '');
  const markPaired = useCallback(() => setPhonePaired(true), []);
  const address = useSetupAddress();

  // Where the setup stands on the server, which the owner's phone shows too. Before anyone owns the kiosk both are on
  // Account, whatever the server follows, so the kiosk's own word is enough until then.
  const { status, report } = useSetupStatus(wifiDone);
  const isFollowed = status !== undefined && status !== null;
  const step = registered ? status?.step : undefined;
  // Owned, and the server hasn't yet said whether it follows the setup: nothing to show but that the kiosk is waiting.
  const isAsking = registered && status === undefined;
  const chapters = status === null ? CHAPTERS.filter(chapter => chapter !== 'location') : CHAPTERS;

  let current: Chapter;
  let done: Record<Chapter, boolean>;
  let needsNetwork: boolean;
  if (step) {
    const at = step === 'done' ? CHAPTERS.length : CHAPTERS.indexOf(STEP_CHAPTERS[step]);
    const isDone = (chapter: Chapter) => (chapter === 'wifi' ? wifiDone : CHAPTERS.indexOf(chapter) < at);
    done = {
      wifi: isDone('wifi'),
      account: isDone('account'),
      spotify: isDone('spotify'),
      soloist: isDone('soloist'),
      location: isDone('location'),
      presence: isDone('presence')
    };
    current = wifiDone ? STEP_CHAPTERS[step] : 'wifi';
    needsNetwork = step !== 'presence' && step !== 'done';
  } else {
    done = {
      wifi: wifiDone,
      account: registered,
      spotify: person !== undefined,
      soloist: isSoloistSet && !isSayingSoloistSet,
      location: true,
      presence: phonePaired
    };
    current = chapters.find(chapter => !done[chapter]) ?? 'presence';
    needsNetwork = isAsking || !(done.account && done.spotify && done.soloist);
  }
  // Everything before Presence happens over the network. Off it, the chapters would wait for ever, so setup goes back
  // to the Wi-Fi chapter, and picks up where it was once the kiosk is on a network again. Presence needs none.
  if (wifiDone && needsNetwork && missed >= LOST_AFTER) {
    setWifiDone(false);
    setScanned(null);
  }
  useRegistration(wifiDone && !registered, reloadPage);

  // What only the kiosk knows of its setup, told to a server that follows it as each thing comes to be so.
  const soloistDevice = soloist.deviceName ? soloist.deviceName.slice(0, 64) : undefined;
  useEffect(() => {
    if (!isFollowed || !registered) return;
    const facts = {
      ...(soloistDevice && { soloist_device: soloistDevice }),
      ...(soloistSignedIn && { soloist_signed_in: true }),
      ...(phonePaired && { phone_paired: true })
    };
    if (Object.keys(facts).length > 0) void report(facts);
  }, [isFollowed, registered, soloistDevice, soloistSignedIn, phonePaired, report]);

  // Location was saved, or skipped, on the phone: the kiosk gets its config again, so the app opens with the postcode,
  // the weather's place and the stops that were chosen.
  const isPastLocation = step === 'presence' || step === 'done';
  useEffect(() => {
    if (isPastLocation) void loadDeviceConfig();
  }, [isPastLocation]);

  const finish = async () => {
    // The sign-in left word to offer pairing their phone, which this has done.
    takePhoneToPair();
    finishSetup();
    // The server is told, so the phone says so too; Done opens the app whether or not it hears.
    if (isFollowed) {
      await Promise.race([report({ finished: true }), new Promise(resolve => setTimeout(resolve, FINISH_REPORT_MS))]);
    }
    onFinished();
  };
  const onDone = () => void finish();

  let page: ReactNode;
  if (current === 'wifi' && hasKioskCamera === undefined) {
    page = <Waiting />;
  } else if (current === 'wifi') {
    page = hasKioskCamera ? (
      <WifiByCamera
        wifi={wifi}
        scanned={scanned}
        onJoined={recheckWifi}
        onRead={ssid => setScanned({ ssid, isConfirmed: false })}
        onFailed={() => setScanned(null)}
        onContinue={() => setScanned(joined => joined && { ...joined, isConfirmed: true })}
        onScanSetup={setIsScanDialogOpen}
      />
    ) : (
      <WifiSettings wifi={wifi} onJoined={recheckWifi} />
    );
  } else if (isAsking) {
    page = <Waiting />;
  } else if (current === 'location') {
    page = <OnPhone lead={t('setup.location_on_phone')} address={address} />;
  } else if (current === 'presence' && person) {
    page = <Presence person={person} isPaired={phonePaired || step === 'done'} onPaired={markPaired} onDone={onDone} />;
  } else if (current === 'presence') {
    // Nobody is signed in on this kiosk to pair a phone for (its storage was cleared since): there is only Done left.
    page = <Complete person={undefined} onDone={onDone} />;
  } else if (current === 'soloist' && step === undefined && isSayingSoloistSet) {
    page = (
      <div className="setup-wizard-center">
        <div className="wifi-join-progress">
          <span className="wifi-join-progress-mark">
            <Check aria-hidden="true" />
          </span>
          <p className="wifi-join-progress-line" role="status">
            {t('setup.soloist_set')}
          </p>
          <button
            type="button"
            className="button search-dialog-confirm wifi-join-progress-button"
            onClick={() => setSoloistAcknowledged(true)}
          >
            {t('common.continue')}
          </button>
        </div>
      </div>
    );
  } else if (current === 'soloist' && (step === 'soloist_sign_in' || (step === undefined && key === 'saved'))) {
    page = <SpotifyPick device={soloist.isSignedIn === false ? (soloist.deviceName ?? KIOSK_NAME) : null} />;
  } else if (current === 'account') {
    page = (
      <div className="setup-wizard-center">
        <p className="setup-wizard-lead">{t('setup.scan')}</p>
        {address ? (
          <QrCode text={address} className="setup-wizard-code" label={t('pairing.code')} />
        ) : (
          <LoaderCircle className="w-10 h-10 animate-spin text-accent" aria-hidden="true" />
        )}
      </div>
    );
  } else {
    page = (
      <>
        {current === 'spotify' && (step ? <FollowedSignIn signIn={status?.spotify_sign_in} /> : <SpotifySignIn />)}
        <OnPhone lead={t(current === 'soloist' ? 'setup.soloist' : 'setup.spotify_on_phone')} address={address} />
      </>
    );
  }

  if (isWelcoming) {
    return (
      <div className="tablet-container" data-colour={loadThemeColour()}>
        <main className="app-modal-panel setup-welcome select-none" aria-label={t('setup.welcome')}>
          <div className="setup-welcome-logo" aria-hidden="true">
            <span className="setup-wizard-mark setup-welcome-mark">
              <AudioLines className="lucide" />
            </span>
            <span className="setup-wizard-name setup-welcome-name">The Max Mix.</span>
          </div>
          <h1 className="setup-welcome-title">{t('setup.welcome')}</h1>
          <p className="setup-welcome-text">{t('setup.welcome_text')}</p>
          <button
            type="button"
            className="button search-dialog-confirm setup-wizard-button"
            onClick={() => setIsWelcoming(false)}
          >
            {t('setup.start')}
          </button>
        </main>
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
            {chapters.map(chapter => (
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
            {page}
          </div>
        </section>
      </main>
    </div>
  );
}
