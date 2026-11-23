import { useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react';
import {
  getLyricsStyle,
  LYRICS_ALIGNS,
  LYRICS_SIZES,
  lyricsScale,
  setLyricsStyle,
  subscribeLyricsStyle
} from '../../utils/lyricsStyle';
import type { LyricsAlign, LyricsStyle } from '../../utils/lyricsStyle';
import { useT } from '../../i18n/translate';
import SettingsChips from './SettingsChips';
import SettingsSection from './SettingsSection';

const ALIGN_ICONS: Record<LyricsAlign, typeof AlignLeft> = { left: AlignLeft, center: AlignCenter, right: AlignRight };
const SAMPLE_LINES = ['lyrics.sample_1', 'lyrics.sample_2', 'lyrics.sample_3'] as const;
/** The sample's type grows with each size, like the lyrics themselves. */
const GLYPH_PX: Record<LyricsStyle['size'], number> = { small: 15, medium: 18, large: 22, 'x-large': 26 };

/**
 * How synced lyrics look, on the Spotify page: a few lines drawn the way the lyrics panel draws them (the classes are
 * the panel's own, so the preview is what plays), then their type size and alignment, each applied as soon as it is
 * tapped. `onChange` saves them where the kiosk keeps them (countdown-server, once someone owns it); without it they
 * are this tablet's own.
 */
export default function LyricsSettings({
  onChange = setLyricsStyle
}: Readonly<{ onChange?: ((style: LyricsStyle) => void) | undefined }>) {
  const t = useT();
  const style = useSyncExternalStore(subscribeLyricsStyle, getLyricsStyle);
  return (
    <SettingsSection id="lyrics-label" title={t('settings.lyrics')}>
      <div className="lyrics-preview" aria-hidden="true">
        <ol
          className="lyrics-list is-synced"
          style={{ '--lyrics-scale': lyricsScale(style.size), textAlign: style.align } as CSSProperties}
        >
          {SAMPLE_LINES.map((line, idx) => (
            <li key={line} className={`lyrics-line ${idx < 2 ? 'is-reached' : ''}`}>
              {t(line)}
            </li>
          ))}
        </ol>
      </div>
      <div className="lyrics-look">
        <SettingsChips
          label={t('lyrics.size')}
          value={style.size}
          onChange={size => onChange({ ...style, size })}
          options={LYRICS_SIZES.map(choice => ({
            id: choice.id,
            name: t(`lyrics.size.${choice.id}`),
            label: (
              <span className="lyrics-size-glyph" style={{ fontSize: GLYPH_PX[choice.id] }}>
                Aa
              </span>
            )
          }))}
        />
        <SettingsChips
          label={t('lyrics.alignment')}
          value={style.align}
          onChange={align => onChange({ ...style, align })}
          options={LYRICS_ALIGNS.map(choice => {
            const Icon = ALIGN_ICONS[choice.id];
            return {
              id: choice.id,
              name: t(`lyrics.align.${choice.id}`),
              label: <Icon className="w-6 h-6 shrink-0" aria-hidden="true" />
            };
          })}
        />
      </div>
    </SettingsSection>
  );
}
