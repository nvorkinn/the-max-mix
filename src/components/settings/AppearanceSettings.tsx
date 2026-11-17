import type { CSSProperties } from 'react';
import { Check, Moon, Sun, SunMoon } from 'lucide-react';
import { THEME_COLOURS } from '../../utils/themeColour';
import type { ThemeColour } from '../../utils/themeColour';
import { THEMES } from '../../utils/theme';
import type { Skin, Theme } from '../../utils/theme';

const THEME_ICONS = { day: Sun, night: Moon, auto: SunMoon } as const;

/** Day (paper, with the colour choice below), Auto when the kiosk knows where it is, or Night (dark navy). */
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

/** The colour of the track title, player controls and highlights, in Day and in Night (a lighter shade of it there). */
function ColourChoice({
  colour,
  onChange
}: Readonly<{ colour: ThemeColour; onChange: (colour: ThemeColour) => void }>) {
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
            className="colour-swatch rounded-full"
            style={
              {
                '--swatch': choice.swatch,
                ...('ring' in choice && { '--swatch-ring': choice.ring })
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

/** Dynamic: while music plays, the colours follow the album art, and fade back to the colour above once it stops. Night
    shows the colour's own night shade instead, so Dynamic is greyed out there. */
function DynamicChoice({
  on,
  onChange,
  disabled
}: Readonly<{ on: boolean; onChange: (on: boolean) => void; disabled: boolean }>) {
  return (
    <section className="settings-group">
      <h5 className="settings-group-title" id="dynamic-colour-label">
        Dynamic
      </h5>
      <div className="settings-segmented" role="group" aria-labelledby="dynamic-colour-label">
        {[
          { value: false, label: 'Off' },
          { value: true, label: 'On' }
        ].map(choice => (
          <button
            type="button"
            key={choice.label}
            aria-pressed={on === choice.value}
            onClick={() => onChange(choice.value)}
            disabled={disabled}
            className="settings-segment"
          >
            {choice.label}
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
  onThemeColourChange,
  dynamicColour,
  onDynamicColourChange
}: Readonly<{
  theme: Theme | undefined;
  autoTheme: boolean;
  onThemeChange: ((theme: Theme) => void) | undefined;
  /** The skin on screen; without it, the picked theme stands in (Auto then counts as Day). */
  skin?: Skin | undefined;
  themeColour: ThemeColour | undefined;
  onThemeColourChange: ((colour: ThemeColour) => void) | undefined;
  dynamicColour?: boolean | undefined;
  onDynamicColourChange?: ((on: boolean) => void) | undefined;
}>) {
  const night = (skin ?? theme) === 'night';
  return (
    <div className="settings-stack">
      {theme !== undefined && onThemeChange && <ThemeChoice theme={theme} auto={autoTheme} onChange={onThemeChange} />}
      {themeColour !== undefined && onThemeColourChange && (
        <ColourChoice colour={themeColour} onChange={onThemeColourChange} />
      )}
      {dynamicColour !== undefined && onDynamicColourChange && (
        <DynamicChoice on={dynamicColour} onChange={onDynamicColourChange} disabled={night} />
      )}
    </div>
  );
}
