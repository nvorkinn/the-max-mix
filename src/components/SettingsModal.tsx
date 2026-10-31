import { useEffect, useState } from 'react';
import { X, Settings, Music, CheckCircle2, AlertCircle, Palette, Sparkles, Feather, LogOut, Wifi } from 'lucide-react';
import { signOut, startSignIn } from '../spotify/auth';
import { errorMessage } from '../utils/errorMessage';
import { isKiosk, openWifiSettings } from '../utils/kiosk';
import { getRedirectUri, setDemoMode, setPlaybackMode } from '../spotify/settings';
import { widevineProblem } from '../utils/widevine';
import KioskSystem from './KioskSystem';
import Modal from './Modal';

/** Set by vite.config.ts at build time; tests and other tooling run without it. */
const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? 'dev';

/** Applies a changed setting by reloading the page, which starts everything again from the stored settings. */
function reloadPage() {
  const url = new URL(location.href);
  // A ?demo=true address would switch demo mode straight back on.
  url.searchParams.delete('demo');
  location.assign(url.href);
}

/** A labelled on/off switch. */
function SwitchRow({
  label,
  description,
  checked,
  disabled = false,
  onChange
}: Readonly<{
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}>) {
  return (
    <div className="modal-card flex items-center justify-between gap-3 p-3 rounded-2xl border">
      <div>
        <div className="text-xs font-bold">{label}</div>
        <p className="text-muted text-[10px] mt-0.5">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="appearance-switch shrink-0 w-11 h-11 grid place-items-center disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <span aria-hidden="true" className="switch-track block w-11 h-6 rounded-full p-0.5 transition-all">
          <span
            className={`switch-thumb block w-5 h-5 rounded-full transition-all ${checked ? 'translate-x-5' : ''}`}
          />
        </span>
      </button>
    </div>
  );
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  authInfo?: { authenticated?: boolean; demoMode?: boolean; playbackMode?: string | undefined };
  signInError?: string | null;
  onReload?: () => void;
  currentTheme?: string;
  onThemeChange?: (theme: string) => void;
  statusMessage?: string | null;
}

export default function SettingsModal({
  isOpen,
  onClose,
  authInfo,
  signInError = null,
  onReload = reloadPage,
  currentTheme = 'neon',
  onThemeChange,
  statusMessage
}: Readonly<SettingsModalProps>) {
  const [actionError, setActionError] = useState<string | null>(null);
  // Why this browser cannot be the speaker (no Widevine), checked each time Settings opens; null while it can.
  const [cannotPlay, setCannotPlay] = useState<string | null>(null);
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    widevineProblem()
      .then(problem => {
        if (!cancelled) setCannotPlay(problem);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen]);
  if (!isOpen) return null;

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

  let spotifyStatus = 'Sign in with a Spotify Premium account to control a real device.';
  if (authInfo?.demoMode) {
    spotifyStatus = 'Playback is simulated. Turn demo mode off below to use Spotify.';
  } else if (authInfo?.authenticated) {
    spotifyStatus = `Connected to Spotify. Playback mode: ${authInfo.playbackMode}.`;
  }

  return (
    <Modal
      labelledBy="settings-title"
      onClose={onClose}
      className="app-modal-panel border rounded-3xl p-6 max-w-md relative shadow-2xl text-left select-none"
    >
      {/* Close Button */}
      <button
        type="button"
        data-modal-autofocus
        onClick={onClose}
        aria-label="Close settings"
        className="modal-icon-button absolute top-4 right-4 w-11 h-11 rounded-full active:scale-90 flex items-center justify-center transition-all"
      >
        <X className="w-5 h-5" />
      </button>

      <h3 id="settings-title" className="text-lg font-semibold flex items-center gap-2 mb-1 pr-12">
        <Settings className="w-5 h-5 text-accent" />
        Settings
      </h3>
      <p className="text-xs text-muted mb-4">Personalise the appearance and Spotify connection of THE MAX MIX</p>

      {/* Appearance */}
      <div className="mb-5 space-y-2">
        <div className="flex items-center space-x-1.5 text-xs font-bold text-muted">
          <Palette className="w-3.5 h-3.5 text-accent" />
          <span>APPEARANCE</span>
        </div>

        <div className="grid grid-cols-1 gap-2">
          {THEMES.map(t => {
            const isSelected = currentTheme === t.id;

            return (
              <button
                type="button"
                key={t.id}
                aria-pressed={isSelected}
                onClick={() => onThemeChange?.(t.id)}
                className="modal-option p-3 rounded-2xl text-left cursor-pointer transition-all border flex items-center justify-between"
              >
                <div className="flex items-center space-x-3">
                  <div className="modal-card w-9 h-9 rounded-xl border flex items-center justify-center">{t.icon}</div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold">{t.name}</span>
                      <span className="modal-badge text-[9px] uppercase font-bold px-1.5 py-0.2 rounded-full">
                        {t.badge}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted mt-0.5">{t.desc}</p>
                  </div>
                </div>

                <div className="shrink-0 pl-2">
                  <div className="appearance-indicator w-4 h-4 rounded-full border-2 flex items-center justify-center">
                    {isSelected && <div className="w-1.5 h-1.5 rounded-full" />}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Status Card */}
      <div className="modal-card p-3.5 rounded-2xl border mb-4 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-xs font-semibold text-muted">Spotify connection:</span>
          {authInfo?.authenticated ? (
            <span className="modal-status status-success flex items-center text-xs font-bold gap-1 px-2 py-0.5 rounded-full border">
              <CheckCircle2 className="w-3.5 h-3.5" /> Connected
            </span>
          ) : (
            <span className="modal-status status-warning flex items-center text-xs font-bold gap-1 px-2 py-0.5 rounded-full border">
              <AlertCircle className="w-3.5 h-3.5" /> {authInfo?.demoMode ? 'Demo mode' : 'Not connected'}
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted">{spotifyStatus}</p>
      </div>

      {/* Connection */}
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

        {!authInfo?.demoMode && (
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
        )}

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

        <SwitchRow
          label="Play in this browser"
          description={
            cannotPlay
              ? `Unavailable: ${cannotPlay}`
              : 'On: this screen is the speaker. Off: it only controls another Spotify device.'
          }
          checked={!cannotPlay && authInfo?.playbackMode !== 'remote'}
          disabled={Boolean(cannotPlay)}
          onChange={browser => {
            setPlaybackMode(browser ? 'browser' : 'remote');
            onReload();
          }}
        />
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
        {isKiosk() && <KioskSystem />}

        <SwitchRow
          label="Demo mode"
          description="Simulated playback and queue, no Spotify account needed."
          checked={Boolean(authInfo?.demoMode)}
          onChange={on => {
            setDemoMode(on);
            onReload();
          }}
        />
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
