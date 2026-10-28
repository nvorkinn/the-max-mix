import React from 'react';
import { X, Key, Music, CheckCircle2, AlertCircle, Palette, Sparkles, Feather } from 'lucide-react';

export default function SettingsModal({ isOpen, onClose, authInfo, currentTheme = 'neon', onThemeChange }) {
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
                  onClick={() => onThemeChange && onThemeChange(t.id)}
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
          <p className="text-[11px] text-neutral-400">
            {authInfo?.demoMode
              ? 'Playback is simulated. Set DEMO_MODE=false in the server environment and restart to use Spotify.'
              : authInfo?.authenticated
                ? `Connected to Spotify. Playback mode: ${authInfo.playbackMode}.`
                : authInfo?.configured
                  ? 'Sign in with a Spotify Premium account to control a real device.'
                  : 'Configure the Spotify client ID and secret in the server environment, then restart.'}
          </p>
        </div>

        {/* Action Button */}
        <div className="space-y-3">
          {!authInfo?.demoMode && authInfo?.configured && (
            <a
              href="/api/auth/login"
              className="w-full py-3 px-4 bg-[#1DB954] hover:bg-[#1aa34a] text-black font-extrabold text-sm rounded-xl flex items-center justify-center gap-2 shadow-lg active:scale-98 transition-all"
            >
              <Music className="w-4 h-4 fill-black" />
              {authInfo?.authenticated ? 'Re-authenticate with Spotify' : 'Log in with Spotify'}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
