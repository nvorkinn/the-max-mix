import { useState } from 'react';
import { X, Settings, Music, CheckCircle2, AlertCircle, Palette, Sparkles, Feather, LogOut, Wifi } from 'lucide-react';
import { signOut, startSignIn } from '../spotify/auth';
import { errorMessage } from '../utils/errorMessage';
import { isKiosk, openWifiSettings } from '../utils/kiosk';
import { getRedirectUri, reloadSettings } from '../spotify/settings';
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
  authInfo?: { authenticated?: boolean };
  signInError?: string | null;
  onReload?: () => void;
  currentTheme?: string;
  onThemeChange?: (theme: string) => void;
  statusMessage?: string | null;
  /** The kiosk's screen sleep delay, shown on the kiosk only. */
  screenSleep?: ScreenSleepMinutes;
  onScreenSleepChange?: (minutes: ScreenSleepMinutes) => void;
}

function SettingsContent({
  onClose,
  authInfo,
  signInError = null,
  onReload = reloadSettings,
  currentTheme = 'neon',
  onThemeChange,
  statusMessage,
  screenSleep,
  onScreenSleepChange
}: Readonly<SettingsModalProps>) {
  const [actionError, setActionError] = useState<string | null>(null);
  const THEMES = [
    {
      id: 'neon',
      name: 'Studio',
      badge: 'Signature',
      desc: 'Soft charcoal, fresh lime accents, and an album-inspired atmosphere',
      icon: <Sparkles className="w-4 h-4 text-accent" />
    },
    {
      id: 'minimal',
      name: 'Paper',
      badge: 'Light',
      desc: 'Warm paper surfaces, forest-green accents, and understated contrast',
      icon: <Feather className="w-4 h-4 text-accent" />
    }
  ];

  const error = actionError || signInError;

  return (
    <Modal
      labelledBy="settings-title"
      onClose={onClose}
      className="app-modal-panel border rounded-3xl p-6 max-w-md relative shadow-2xl text-left select-none"
    >
      <button
        type="button"
        data-modal-autofocus
        onClick={onClose}
        aria-label="Close settings"
        className="modal-icon-button absolute top-4 right-4 w-11 h-11 rounded-full active:scale-90 flex items-center justify-center transition-all"
      >
        <X className="w-5 h-5" />
      </button>

      <h3 id="settings-title" className="text-lg font-semibold flex items-center gap-2 mb-4 pr-12">
        <Settings className="w-5 h-5 text-accent" />
        Settings
      </h3>
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
        {isKiosk() && <KioskSystem />}
      </div>

      <div className="mt-5 space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-muted">
          <Palette className="w-3.5 h-3.5 text-accent" />
          <span>APPEARANCE</span>
        </div>
        {THEMES.map(theme => (
          <button
            type="button"
            key={theme.id}
            aria-pressed={currentTheme === theme.id}
            onClick={() => onThemeChange?.(theme.id)}
            className="modal-option p-3 rounded-2xl text-left transition-all border flex items-center justify-between w-full"
          >
            <div className="flex items-center gap-3">
              <div className="modal-card w-9 h-9 rounded-xl border flex items-center justify-center">{theme.icon}</div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold">{theme.name}</span>
                  <span className="modal-badge text-[9px] uppercase font-bold px-1.5 rounded-full">{theme.badge}</span>
                </div>
                <p className="text-[10px] text-muted mt-0.5">{theme.desc}</p>
              </div>
            </div>
            <div className="appearance-indicator w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0">
              {currentTheme === theme.id && <div className="w-1.5 h-1.5 rounded-full" />}
            </div>
          </button>
        ))}
      </div>
      <p className="mt-5 text-center text-[10px] text-muted">
        Version <span className="font-mono">{APP_VERSION}</span>
      </p>
      {statusMessage && (
        <div className="app-toast" role="status">
          {statusMessage}
        </div>
      )}
    </Modal>
  );
}

export default function SettingsModal(props: Readonly<SettingsModalProps>) {
  return props.isOpen ? <SettingsContent {...props} /> : null;
}
