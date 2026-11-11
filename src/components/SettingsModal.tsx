import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { X, Settings, Music, CheckCircle2, AlertCircle, LogOut, Wifi } from 'lucide-react';
import { signOut, startSignIn } from '../spotify/auth';
import { errorMessage } from '../utils/errorMessage';
import { isKiosk, openWifiSettings } from '../utils/kiosk';
import { useSpotifyPolling } from '../hooks/useSpotifyPolling';
import { setPollSpotify } from '../spotify/polling';
import { getRedirectUri, reloadSettings } from '../spotify/settings';
import { SCREEN_SLEEP_CHOICES } from '../utils/screenSleep';
import type { ScreenSleepMinutes } from '../utils/screenSleep';
import { THEME_COLOURS } from '../utils/themeColour';
import type { ThemeColour } from '../utils/themeColour';
import type { KioskUpdate } from '../hooks/useKioskUpdate';
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

/** Whether the app reads Spotify on a timer to keep up with changes made elsewhere (say, from a phone). */
function PollingRow() {
  const { enabled, quotaExceeded } = useSpotifyPolling();
  let note = 'Off: playback is read when the page opens and after each button press, not every few seconds.';
  if (quotaExceeded) note = "Stopped: Spotify's quota is used up. Restart the app to read Spotify by itself again.";
  else if (enabled) {
    note = 'On: playback and the queue are read every few seconds, so changes from other devices show up.';
  }
  return (
    <div className="modal-card p-3 rounded-2xl border">
      <div className="text-xs font-bold" id="poll-spotify-label">
        Poll Spotify for updates
      </div>
      <div className="flex gap-1.5 mt-2" role="group" aria-labelledby="poll-spotify-label">
        {[true, false].map(choice => (
          <button
            type="button"
            key={String(choice)}
            aria-pressed={enabled === choice}
            onClick={() => setPollSpotify(choice)}
            className="modal-option flex-1 min-h-11 rounded-xl border text-xs font-bold"
          >
            {choice ? 'On' : 'Off'}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-muted">{note}</p>
    </div>
  );
}

/** The colour of the track title, player controls and highlights. */
function ThemeColourRow({
  colour,
  onChange
}: Readonly<{ colour: ThemeColour; onChange: (colour: ThemeColour) => void }>) {
  return (
    <div className="modal-card p-3 rounded-2xl border">
      <div className="text-xs font-bold" id="theme-colour-label">
        Colour
      </div>
      <div className="flex flex-wrap gap-3 mt-2" role="group" aria-labelledby="theme-colour-label">
        {THEME_COLOURS.map(choice => (
          <button
            type="button"
            key={choice.id}
            aria-label={choice.label}
            aria-pressed={colour === choice.id}
            onClick={() => onChange(choice.id)}
            className="colour-swatch w-11 h-11 rounded-full"
            style={{ '--swatch': choice.swatch } as CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  authInfo?: { authenticated?: boolean };
  signInError?: string | null;
  onReload?: () => void;
  /** The kiosk's screen sleep delay, shown on the kiosk only. */
  screenSleep?: ScreenSleepMinutes;
  onScreenSleepChange?: (minutes: ScreenSleepMinutes) => void;
  themeColour?: ThemeColour;
  onThemeColourChange?: (colour: ThemeColour) => void;
  /** The kiosk's software update, shown on the kiosk only. */
  kioskUpdate?: KioskUpdate;
}

function SettingsContent({
  onClose,
  authInfo,
  signInError = null,
  onReload = reloadSettings,
  screenSleep,
  onScreenSleepChange,
  themeColour,
  onThemeColourChange,
  kioskUpdate
}: Readonly<SettingsModalProps>) {
  const [actionError, setActionError] = useState<string | null>(null);

  // Opening the settings asks GitHub again whether a newer version is out, so the answer is never the one from hours ago.
  const checkForUpdate = kioskUpdate?.checkNow;
  useEffect(() => {
    checkForUpdate?.();
  }, [checkForUpdate]);

  const error = actionError || signInError;

  return (
    <Modal
      labelledBy="settings-title"
      onClose={onClose}
      className="app-modal-panel border rounded-3xl p-6 max-w-md relative shadow-2xl text-left select-none"
    >
      <div className="modal-header mb-4 flex items-center justify-between gap-2">
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
      <div className="modal-card p-3.5 rounded-2xl border mb-4">
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

        {themeColour !== undefined && onThemeColourChange && (
          <ThemeColourRow colour={themeColour} onChange={onThemeColourChange} />
        )}
        <PollingRow />
        {isKiosk() && (
          <button
            type="button"
            onClick={openWifiSettings}
            className="modal-option w-full flex items-center justify-between gap-3 p-3 min-h-14 rounded-2xl border active:scale-98 text-left transition-all"
          >
            <span className="text-xs font-bold">Wi-Fi network</span>
            <Wifi className="w-5 h-5 shrink-0 text-accent" aria-hidden="true" />
          </button>
        )}
        {isKiosk() && screenSleep !== undefined && onScreenSleepChange && (
          <ScreenSleepRow minutes={screenSleep} onChange={onScreenSleepChange} />
        )}
        {isKiosk() && kioskUpdate && (
          <KioskSystem
            update={kioskUpdate}
            onUpdate={() => {
              // The update console takes over the screen, so the settings behind it are closed.
              kioskUpdate.start();
              onClose();
            }}
          />
        )}
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
