import { useSyncExternalStore } from 'react';
import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react';
import {
  getLyricsStyle,
  LYRICS_ALIGNS,
  LYRICS_SIZES,
  setLyricsStyle,
  subscribeLyricsStyle
} from '../../utils/lyricsStyle';
import type { LyricsAlign, LyricsStyle } from '../../utils/lyricsStyle';
import { useT } from '../../i18n/translate';

const ALIGN_ICONS: Record<LyricsAlign, typeof AlignLeft> = { left: AlignLeft, center: AlignCenter, right: AlignRight };

/**
 * The Lyrics page: synced lyrics' type size and alignment, each applied as soon as it is tapped. `onChange` saves them where the kiosk
 * keeps them (countdown-server, once someone owns it); without it they are this tablet's own.
 */
export default function LyricsSettings({
  onChange = setLyricsStyle
}: Readonly<{ onChange?: ((style: LyricsStyle) => void) | undefined }>) {
  const t = useT();
  const style = useSyncExternalStore(subscribeLyricsStyle, getLyricsStyle);
  return (
    <div className="settings-stack">
      <section className="settings-group">
        <h5 className="settings-group-title" id="lyrics-size-label">
          {t('lyrics.size')}
        </h5>
        <div className="settings-segmented" role="group" aria-labelledby="lyrics-size-label">
          {LYRICS_SIZES.map(choice => (
            <button
              type="button"
              key={choice.id}
              aria-pressed={style.size === choice.id}
              onClick={() => onChange({ ...style, size: choice.id })}
              className="settings-segment"
            >
              {t(`lyrics.size.${choice.id}`)}
            </button>
          ))}
        </div>
      </section>
      <section className="settings-group">
        <h5 className="settings-group-title" id="lyrics-align-label">
          {t('lyrics.alignment')}
        </h5>
        <div className="settings-segmented" role="group" aria-labelledby="lyrics-align-label">
          {LYRICS_ALIGNS.map(choice => {
            const Icon = ALIGN_ICONS[choice.id];
            return (
              <button
                type="button"
                key={choice.id}
                aria-pressed={style.align === choice.id}
                onClick={() => onChange({ ...style, align: choice.id })}
                className="settings-segment"
              >
                <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
                {t(`lyrics.align.${choice.id}`)}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
