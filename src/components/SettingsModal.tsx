import { useState } from 'react';
import { X, Key, Music, CheckCircle2, AlertCircle, Palette, Sparkles, Feather, LogOut, Wifi } from 'lucide-react';
import { signOut, startSignIn } from '../spotify/auth';
import { errorMessage } from '../utils/errorMessage';
import { isKiosk, WIFI_PORTAL_URL } from '../utils/kiosk';
import { getRedirectUri, setDemoMode, setPlaybackMode } from '../spotify/settings';

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
  onChange
}: Readonly<{
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}>) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-white/5 border border-white/10">
      <div>
        <div className="text-xs font-bold text-white">{label}</div>
        <p className="text-[10px] text-neutral-400 mt-0.5">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`shrink-0 w-11 h-6 rounded-full p-0.5 transition-all ${checked ? 'bg-emerald-500' : 'bg-neutral-600'}`}
      >
        <span className={`block w-5 h-5 rounded-full bg-white transition-all ${checked ? 'translate-x-5' : ''}`} />
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
}

export default function SettingsModal({
  isOpen,
  onClose,
  authInfo,
  signInError = null,
  onReload = reloadPage,
  currentTheme = 'neon',
  onThemeChange
}: Readonly<SettingsModalProps>) {
  const [actionError, setActionError] = useState<string | null>(null);
  if (!isOpen) return null;

  const THEMES = [
    {
      id: 'neon',
      name: 'Studio',
      badge: 'Signature',
      desc: 'Soft charcoal, fresh lime accents, and an album-inspired atmosphere',
      icon: <Sparkles className="w-4 h-4 text-[#d5f580]" />,
      border: 'border-[#d5f580]/40'
    },
    {
      id: 'minimal',
      name: 'Paper',
      badge: 'Light',
      desc: 'Warm paper surfaces, forest-green accents, and understated contrast',
      icon: <Feather className="w-4 h-4 text-stone-300" />,
      border: 'border-stone-300/40'
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
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md z-50 flex items-center justify-center p-4 select-none">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="app-modal-panel border rounded-3xl p-6 max-w-md w-full relative shadow-2xl text-left max-h-[92vh] overflow-y-auto"
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 active:scale-90 text-white flex items-center justify-center transition-all"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 id="settings-title" className="text-lg font-semibold text-white flex items-center gap-2 mb-1">
          <Key className="w-5 h-5 text-[#d5f580]" />
          Make it yours
        </h3>
        <p className="text-xs text-neutral-400 mb-4">
          Customize the visual design and Spotify connection of THE MAX MIX
        </p>

        {/* Skin / Theme Selector Section */}
        <div className="mb-5 space-y-2">
          <div className="flex items-center space-x-1.5 text-xs font-bold text-neutral-300">
            <Palette className="w-3.5 h-3.5 text-purple-400" />
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
                  className={`p-3 rounded-2xl text-left cursor-pointer transition-all border flex items-center justify-between ${
                    isSelected
                      ? `bg-white/10 ${t.border} shadow-lg ring-1 ring-white/20`
                      : 'bg-white/5 border-white/5 hover:bg-white/10'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <div className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                      {t.icon}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white">{t.name}</span>
                        <span className="text-[9px] uppercase font-bold px-1.5 py-0.2 rounded-full bg-white/10 text-neutral-300">
                          {t.badge}
                        </span>
                      </div>
                      <p className="text-[10px] text-neutral-400 mt-0.5">{t.desc}</p>
                    </div>
                  </div>

                  <div className="shrink-0 pl-2">
                    <div
                      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                        isSelected ? 'border-emerald-400 bg-emerald-500' : 'border-neutral-500'
                      }`}
                    >
                      {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-black" />}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Status Card */}
        <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 mb-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-300">Spotify Link Status:</span>
            {authInfo?.authenticated ? (
              <span className="flex items-center text-xs font-bold text-emerald-400 gap-1 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                <CheckCircle2 className="w-3.5 h-3.5" /> Connected
              </span>
            ) : (
              <span className="flex items-center text-xs font-bold text-amber-400 gap-1 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                <AlertCircle className="w-3.5 h-3.5" /> {authInfo?.demoMode ? 'Demo mode' : 'Not connected'}
              </span>
            )}
          </div>
          <p className="text-[11px] text-neutral-400">{spotifyStatus}</p>
        </div>

        {/* Connection */}
        <div className="space-y-3">
          {error && (
            <p role="alert" className="text-xs text-rose-300">
              {error}
            </p>
          )}

          {signInError && (
            <p className="text-[11px] text-neutral-400">
              Register this exact redirect address in your Spotify app settings:{' '}
              <code className="text-[#d5f580] break-all">{getRedirectUri()}</code>
            </p>
          )}

          {!authInfo?.demoMode && (
            <button
              type="button"
              onClick={() => {
                setActionError(null);
                startSignIn().catch((caught: unknown) => setActionError(errorMessage(caught)));
              }}
              className="w-full py-3 px-4 bg-[#1DB954] hover:bg-[#1aa34a] text-black font-extrabold text-sm rounded-xl flex items-center justify-center gap-2 shadow-lg active:scale-98 transition-all"
            >
              <Music className="w-4 h-4 fill-black" />
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
            description="On: this screen is the speaker. Off: it only controls another Spotify device."
            checked={authInfo?.playbackMode !== 'remote'}
            onChange={browser => {
              setPlaybackMode(browser ? 'browser' : 'remote');
              onReload();
            }}
          />
          {isKiosk() && (
            <button
              type="button"
              onClick={() => location.assign(WIFI_PORTAL_URL)}
              className="w-full flex items-center justify-between gap-3 p-3 min-h-14 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 active:scale-98 text-left transition-all"
            >
              <span>
                <span className="block text-xs font-bold text-white">Wi-Fi network</span>
                <span className="block text-[10px] text-neutral-400 mt-0.5">Change the network this device uses</span>
              </span>
              <Wifi className="w-5 h-5 shrink-0 text-[#d5f580]" aria-hidden="true" />
            </button>
          )}

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
      </div>
    </div>
  );
}
