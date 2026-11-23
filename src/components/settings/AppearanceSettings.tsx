import type { CSSProperties } from 'react';
import { Check, Disc3, Play } from 'lucide-react';
import { swatchOf, THEME_COLOURS } from '../../utils/themeColour';
import type { ThemeColour } from '../../utils/themeColour';
import { useT } from '../../i18n/translate';
import { ARRIVALS_TRANSITIONS, saveArrivalsTransition, useArrivalsTransition } from '../../utils/arrivalsTransition';
import SettingsChips from './SettingsChips';
import SettingsSection from './SettingsSection';
import SettingsToggle from './SettingsToggle';

/** How a sample is painted: the fill of its play button and bar, the accent of its title, and the ink on the fill. */
interface SamplePaint {
  fill: string;
  accent: string;
  ink: string;
  /** The cover's own colours, for the sample that follows album art; none shows a plain record. */
  art?: string;
}

/** A warm cover, and the colours Dynamic would take from it, for the sample of what it does while music plays. */
const ART_PAINT: SamplePaint = {
  fill: 'linear-gradient(135deg, #f59e4a, #e0527d)',
  accent: '#f5a25a',
  ink: '#2a1208',
  art: 'linear-gradient(140deg, #f7b267 0%, #e0527d 55%, #5b2a86 100%)'
};

function paintOf(colour: ThemeColour): SamplePaint {
  const choice = THEME_COLOURS.find(option => option.id === colour) ?? THEME_COLOURS[0];
  return { fill: swatchOf(choice), accent: choice.accent, ink: 'accentInk' in choice ? choice.accentInk : '#fff' };
}

/**
 * A small now-playing strip in a colour: a cover, the song's title in the accent, the progress bar and the play button
 * in the fill. Painted with its own colours rather than the page's, which follow the album art while music plays.
 */
function ColourSample({ paint, caption }: Readonly<{ paint: SamplePaint; caption: string }>) {
  const t = useT();
  return (
    <figure
      className="colour-sample"
      style={
        {
          '--sample-fill': paint.fill,
          '--sample-accent': paint.accent,
          '--sample-ink': paint.ink,
          '--sample-art': paint.art
        } as CSSProperties
      }
    >
      <div className="colour-sample-player" aria-hidden="true">
        <span className={paint.art ? 'colour-sample-art has-art' : 'colour-sample-art'}>
          {!paint.art && <Disc3 className="w-7 h-7" />}
        </span>
        <span className="colour-sample-text">
          <span className="colour-sample-title">{t('appearance.sample_title')}</span>
          <span className="colour-sample-artist">{t('appearance.sample_artist')}</span>
          <span className="colour-sample-bar">
            <span className="colour-sample-progress" />
          </span>
        </span>
        <span className="colour-sample-play">
          <Play className="w-5 h-5" fill="currentColor" />
        </span>
      </div>
      <figcaption className="colour-sample-caption">{caption}</figcaption>
    </figure>
  );
}

/**
 * The Appearance page: the colour of the track title, player controls and highlights, shown on a sample of the player as
 * it is picked; and Dynamic, which while music plays takes the colours from the album art instead (and fades back once
 * it stops), shown on a second sample beside the first while it is on. Then how the Dashboard's arrivals change from one
 * stop to the next, a setting of this tablet's own that the Dashboard follows as soon as it is picked.
 */
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
  const t = useT();
  const hasDynamic = dynamicColour !== undefined && onDynamicColourChange !== undefined;
  const arrivalsTransition = useArrivalsTransition();
  return (
    <div className="settings-stack">
      {themeColour !== undefined && onThemeColourChange && (
        <SettingsSection id="theme-colour-label" title={t('appearance.colour')} caption={t('appearance.colour_note')}>
          <div className="settings-swatches" role="group" aria-labelledby="theme-colour-label">
            {THEME_COLOURS.map(choice => (
              <button
                type="button"
                key={choice.id}
                aria-label={t(`colour.${choice.id}`)}
                aria-pressed={themeColour === choice.id}
                onClick={() => onThemeColourChange(choice.id)}
                className="colour-swatch rounded-full"
                style={{ '--swatch': swatchOf(choice), '--swatch-ring': choice.accent } as CSSProperties}
              >
                {themeColour === choice.id && <Check className="colour-swatch-tick" aria-hidden="true" />}
              </button>
            ))}
          </div>
          <div className="colour-samples">
            <ColourSample
              paint={paintOf(themeColour)}
              caption={t(dynamicColour ? 'appearance.sample_idle' : 'appearance.sample_always')}
            />
            {dynamicColour && <ColourSample paint={ART_PAINT} caption={t('appearance.sample_playing')} />}
          </div>
        </SettingsSection>
      )}
      {hasDynamic && (
        <SettingsToggle
          id="dynamic-colour-label"
          title={t('appearance.dynamic')}
          note={t('appearance.dynamic_note')}
          on={dynamicColour}
          onChange={onDynamicColourChange}
        />
      )}
      <SettingsSection id="arrivals-transition-label" title={t('appearance.arrivals')}>
        <SettingsChips
          labelledBy="arrivals-transition-label"
          value={arrivalsTransition}
          onChange={saveArrivalsTransition}
          options={ARRIVALS_TRANSITIONS.map(id => ({ id, label: t(`appearance.arrivals.${id}`) }))}
        />
      </SettingsSection>
    </div>
  );
}
