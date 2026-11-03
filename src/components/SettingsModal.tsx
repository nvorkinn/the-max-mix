import { useEffect, useState } from 'react';
import { X, Settings, Music, CheckCircle2, AlertCircle, LogOut, Wifi } from 'lucide-react';
import { signOut, startSignIn } from '../spotify/auth';
import { errorMessage } from '../utils/errorMessage';
import { isKiosk, openWifiSettings } from '../utils/kiosk';
import { getRedirectUri, reloadSettings, setPlaybackMode } from '../spotify/settings';
import { widevineProblem } from '../utils/widevine';
import { SCREEN_SLEEP_CHOICES } from '../utils/screenSleep';
import type { ScreenSleepMinutes } from '../utils/screenSleep';
import KioskSystem from './KioskSystem';
import Modal from './Modal';

/** Set by vite.config.ts at build time; tests and other tooling run without it. */
const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? 'dev';

/** The kiosk's screen sleep delay: off, or minutes without a touch while nothing plays. */
function ScreenSleepRow({
  minutes,
  onChange
}: Readonly<{ minutes: ScreenSleepMinutes; onChange: (minutes: ScreenSleepMinutes) => void }>) {
  return (
    <div className="modal-card p-3 rounded-2xl border">
      <div className="text-xs font-bold" id="screen-sleep-label">
        Screen sleep
      </div>
      <p className="text-muted text-[10px] mt-0.5">
        Turns the screen off when nobody has touched it for a while and nothing is playing. A tap wakes it.
      </p>
      <div className="flex gap-1.5 mt-2" role="group" aria-labelledby="screen-sleep-label">
        {SCREEN_SLEEP_CHOICES.map(choice => (
          <button
            type="button"
            key={choice}
            aria-pressed={minutes === choice}
            onClick={() => onChange(choice)}
            className="modal-option flex-1 min-h-11 rounded-xl border text-xs font-bold"
          >
            {choice === 0 ? 'Never' : `${choice} min`}
          </button>
        ))}
      </div>
    </div>
  );
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  authInfo?: { authenticated?: boolean; playbackMode?: string | undefined };
  signInError?: string | null;
  onReload?: () => void;
  /** The kiosk's screen sleep delay, shown on the kiosk only. */
  screenSleep?: ScreenSleepMinutes;
  onScreenSleepChange?: (minutes: ScreenSleepMinutes) => void;
}

function SettingsContent({
  onClose,
  authInfo,
  signInError = null,
  onReload = reloadSettings,
  screenSleep,
  onScreenSleepChange
}: Readonly<SettingsModalProps>) {
  const [actionError, setActionError] = useState<string | null>(null);
  const savedMode = authInfo?.playbackMode === 'remote' ? 'remote' : 'browser';
  const [previousMode, setPreviousMode] = useState(savedMode);
  const [pendingMode, setPendingMode] = useState<'browser' | 'remote'>(savedMode);
  if (previousMode !== savedMode) {
    setPreviousMode(savedMode);
    setPendingMode(savedMode);
  }
  // Why this browser cannot be the speaker (no Widevine), checked each time Settings opens; null while it can.
  const [cannotPlay, setCannotPlay] = useState<string | null>(null);
  const [checkingPlayback, setCheckingPlayback] = useState(true);
  useEffect(() => {
    let cancelled = false;
    widevineProblem()
      .then(problem => {
        if (!cancelled) setCannotPlay(problem);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setCannotPlay(`Browser playback could not be checked: ${errorMessage(caught)}`);
      })
      .finally(() => {
        if (!cancelled) setCheckingPlayback(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const modeChanged = pendingMode !== savedMode;
  let browserDescription =
    'Play audio on this tablet. Requires Spotify Premium, HTTPS and browser encrypted media support.';
  if (checkingPlayback) browserDescription = 'Checking browser playback support...';
  else if (cannotPlay) browserDescription = `Unavailable: ${cannotPlay}`;

  const error = actionError || signInError;

  let spotifyStatus = 'Sign in with a Spotify Premium account to control a real device.';
  if (authInfo?.authenticated) spotifyStatus = 'Connected to Spotify. Choose a playback destination below.';

  return (
    <Modal
      labelledBy="settings-title"
      onClose={onClose}
      className="app-modal-panel border rounded-3xl p-6 max-w-md relative shadow-2xl text-left select-none"
    >
      <div className="modal-header mb-1 flex items-center justify-between gap-2">
        <h3 id="settings-title" className="text-lg font-semibold flex items-center gap-2">
          <Settings className="w-5 h-5 text-accent" />
          Settings
        </h3>
        <button
          type="button"
          data-modal-autofocus
          onClick={onClose}
          aria-label="Close settings"
          className="modal-icon-button w-11 h-11 rounded-full active:scale-90 flex items-center justify-center transition-all"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <p className="text-xs text-muted mb-4">Connect Spotify and choose where this tablet plays.</p>

      <div className="modal-card p-3.5 rounded-2xl border mb-4 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs font-semibold text-muted">Spotify connection:</span>
          {authInfo?.authenticated ? (
            <span className="modal-status status-success flex items-center text-xs font-bold gap-1 px-2 py-0.5 rounded-full border">
              <CheckCircle2 className="w-3.5 h-3.5" /> Connected
            </span>
          ) : (
            <span className="modal-status status-warning flex items-center text-xs font-bold gap-1 px-2 py-0.5 rounded-full border">
              <AlertCircle className="w-3.5 h-3.5" /> Not connected
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted">{spotifyStatus}</p>
      </div>

      <div className="space-y-3">
        {error && (
          <p role="alert" className="text-xs status-danger">
            {error}
          </p>
        )}

        {signInError && (
          <p className="text-[11px] text-muted">
            Register this exact redirect address in your Spotify app settings:{' '}
            <code className="text-accent break-all">{getRedirectUri()}</code>
          </p>
        )}

        <button
          type="button"
          onClick={() => {
            setActionError(null);
            startSignIn().catch((caught: unknown) => setActionError(errorMessage(caught)));
          }}
          className="spotify-sign-in w-full py-3 px-4 font-extrabold text-sm rounded-xl flex items-center justify-center gap-2 shadow-lg active:scale-98 transition-all"
        >
          <Music className="w-4 h-4 fill-current" />
          {authInfo?.authenticated ? 'Re-authenticate with Spotify' : 'Log in with Spotify'}
        </button>

        {authInfo?.authenticated && (
          <button
            type="button"
            onClick={() => {
              signOut();
              onReload();
            }}
            className="button button-secondary w-full flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        )}

        <fieldset className="space-y-2">
          <legend className="text-xs font-bold mb-2">Playback destination</legend>
          <label className="playback-choice">
            <input
              type="radio"
              name="playback-destination"
              value="browser"
              checked={pendingMode === 'browser'}
              disabled={checkingPlayback || Boolean(cannotPlay)}
              onChange={() => setPendingMode('browser')}
              aria-label="This device"
            />
            <span>
              <span className="block text-xs font-bold">This device</span>
              <span className="block text-[11px] text-muted mt-1">{browserDescription}</span>
            </span>
          </label>
          <label className="playback-choice">
            <input
              type="radio"
              name="playback-destination"
              value="remote"
              checked={pendingMode === 'remote'}
              onChange={() => setPendingMode('remote')}
              aria-label="Another Spotify device"
            />
            <span>
              <span className="block text-xs font-bold">Another Spotify device</span>
              <span className="block text-[11px] text-muted mt-1">
                Control a Spotify Connect speaker without streaming audio here. Start music in Spotify, then choose
                Speakers.
              </span>
            </span>
          </label>
        </fieldset>
        <p className="text-[11px] text-muted">
          Apply destination changes to reload the app. This won't move or start your music automatically.
        </p>
        <button
          type="button"
          className="button button-secondary w-full"
          disabled={!modeChanged || (pendingMode === 'browser' && (checkingPlayback || Boolean(cannotPlay)))}
          onClick={() => {
            setPlaybackMode(pendingMode);
            onReload();
          }}
        >
          Apply and reload
        </button>
        {isKiosk() && (
          <button
            type="button"
            onClick={openWifiSettings}
            className="modal-option w-full flex items-center justify-between gap-3 p-3 min-h-14 rounded-2xl border active:scale-98 text-left transition-all"
          >
            <span>
              <span className="block text-xs font-bold">Wi-Fi network</span>
              <span className="block text-[10px] text-muted mt-0.5">Change the network this device uses</span>
            </span>
            <Wifi className="w-5 h-5 shrink-0 text-accent" aria-hidden="true" />
          </button>
        )}
        {isKiosk() && screenSleep !== undefined && onScreenSleepChange && (
          <ScreenSleepRow minutes={screenSleep} onChange={onScreenSleepChange} />
        )}
        {isKiosk() && <KioskSystem />}
      </div>

      <p className="mt-5 text-center text-[10px] text-muted">
        Version <span className="font-mono">{APP_VERSION}</span>
      </p>
    </Modal>
  );
}

export default function SettingsModal(props: Readonly<SettingsModalProps>) {
  return props.isOpen ? <SettingsContent {...props} /> : null;
}
