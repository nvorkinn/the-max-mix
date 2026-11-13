import type { CSSProperties } from 'react';
import { Check, Moon, Sun, SunMoon } from 'lucide-react';
import { THEME_COLOURS } from '../../utils/themeColour';
import type { ThemeColour } from '../../utils/themeColour';
import { THEMES } from '../../utils/theme';
import type { Skin, Theme } from '../../utils/theme';

const THEME_ICONS = { day: Sun, night: Moon, auto: SunMoon } as const;

/** Day (paper, with the colour choice below), Night (dark navy), or Auto when the kiosk knows where it is. */
function ThemeChoice({
  theme,
  auto,
  onChange
}: Readonly<{ theme: Theme; auto: boolean; onChange: (theme: Theme) => void }>) {
  return (
    <section className="settings-group">
      <h5 className="settings-group-title" id="theme-label">
        Theme
      </h5>
      <div className="settings-segmented" role="group" aria-labelledby="theme-label">
        {THEMES.filter(choice => auto || choice.id !== 'auto').map(choice => {
          const Icon = THEME_ICONS[choice.id];
          return (
            <button
              type="button"
              key={choice.id}
              aria-pressed={theme === choice.id}
              onClick={() => onChange(choice.id)}
              className="settings-segment"
            >
              <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
              {choice.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** The colour of the track title, player controls and highlights. Night has its own fixed colours, so it is greyed out
    while Night shows (picked, or Auto after sunset); the Day choice is kept for when Day comes back. */
function ColourChoice({
  colour,
  onChange,
  disabled
}: Readonly<{ colour: ThemeColour; onChange: (colour: ThemeColour) => void; disabled: boolean }>) {
  return (
    <section className="settings-group">
      <h5 className="settings-group-title" id="theme-colour-label">
        Colour
      </h5>
      <div className="settings-swatches" role="group" aria-labelledby="theme-colour-label">
        {THEME_COLOURS.map(choice => (
          <button
            type="button"
            key={choice.id}
            aria-label={choice.label}
            aria-pressed={colour === choice.id}
            onClick={() => onChange(choice.id)}
            disabled={disabled}
            className="colour-swatch rounded-full"
            style={
              {
                '--swatch': choice.swatch,
                '--swatch-ring': 'ring' in choice ? choice.ring : choice.swatch
              } as CSSProperties
            }
          >
            {colour === choice.id && <Check className="colour-swatch-tick" aria-hidden="true" />}
          </button>
        ))}
      </div>
    </section>
  );
}

export default function AppearanceSettings({
  theme,
  autoTheme,
  onThemeChange,
  skin,
  themeColour,
  onThemeColourChange
}: Readonly<{
  theme: Theme | undefined;
  autoTheme: boolean;
  onThemeChange: ((theme: Theme) => void) | undefined;
  /** The skin on screen; without it, the picked theme stands in (Auto then counts as Day). */
  skin?: Skin | undefined;
  themeColour: ThemeColour | undefined;
  onThemeColourChange: ((colour: ThemeColour) => void) | undefined;
}>) {
  return (
    <div className="settings-stack">
      {theme !== undefined && onThemeChange && <ThemeChoice theme={theme} auto={autoTheme} onChange={onThemeChange} />}
      {themeColour !== undefined && onThemeColourChange && (
        <ColourChoice colour={themeColour} onChange={onThemeColourChange} disabled={(skin ?? theme) === 'night'} />
      )}
    </div>
  );
}
