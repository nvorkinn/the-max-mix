import { useSyncExternalStore } from 'react';
import { AlignCenter, AlignLeft, AlignRight } from 'lucide-react';
import {
  getLyricsStyle,
  LYRICS_ALIGNS,
  LYRICS_SIZES,
  setLyricsStyle,
  subscribeLyricsStyle
} from '../../utils/lyricsStyle';
import type { LyricsAlign } from '../../utils/lyricsStyle';

const ALIGN_ICONS: Record<LyricsAlign, typeof AlignLeft> = { left: AlignLeft, center: AlignCenter, right: AlignRight };

/** Synced lyrics' type size and alignment, each applied as soon as it is tapped. */
export default function LyricsSettings() {
  const style = useSyncExternalStore(subscribeLyricsStyle, getLyricsStyle);
  return (
    <section className="settings-group" aria-labelledby="synced-lyrics-label">
      <h5 className="settings-group-title" id="synced-lyrics-label">
        Synced Lyrics
      </h5>
      <div className="settings-segmented" role="group" aria-label="Lyrics size">
        {LYRICS_SIZES.map(choice => (
          <button
            type="button"
            key={choice.id}
            aria-pressed={style.size === choice.id}
            onClick={() => setLyricsStyle({ size: choice.id })}
            className="settings-segment"
          >
            {choice.label}
          </button>
        ))}
      </div>
      <div className="settings-segmented" role="group" aria-label="Lyrics alignment">
        {LYRICS_ALIGNS.map(choice => {
          const Icon = ALIGN_ICONS[choice.id];
          return (
            <button
              type="button"
              key={choice.id}
              aria-pressed={style.align === choice.id}
              onClick={() => setLyricsStyle({ align: choice.id })}
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
