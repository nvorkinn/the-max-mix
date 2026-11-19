import type { CSSProperties } from 'react';
import { Check } from 'lucide-react';
import { swatchOf, THEME_COLOURS } from '../../utils/themeColour';
import type { ThemeColour } from '../../utils/themeColour';

/** The colour of the track title, player controls and highlights. */
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
                '--swatch': swatchOf(choice),
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

/** Dynamic: while music plays, the colours follow the album art, and fade back to the colour above once it stops. */
function DynamicChoice({ on, onChange }: Readonly<{ on: boolean; onChange: (on: boolean) => void }>) {
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
  themeColour,
  onThemeColourChange,
  dynamicColour,
  onDynamicColourChange
}: Readonly<{
  themeColour: ThemeColour | undefined;
  onThemeColourChange: ((colour: ThemeColour) => void) | undefined;
  dynamicColour?: boolean | undefined;
  onDynamicColourChange?: ((on: boolean) => void) | undefined;
}>) {
  return (
    <div className="settings-stack">
      {themeColour !== undefined && onThemeColourChange && (
        <ColourChoice colour={themeColour} onChange={onThemeColourChange} />
      )}
      {dynamicColour !== undefined && onDynamicColourChange && (
        <DynamicChoice on={dynamicColour} onChange={onDynamicColourChange} />
      )}
    </div>
  );
}
