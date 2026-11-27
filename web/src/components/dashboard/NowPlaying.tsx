import { Pause, Play, SkipForward } from 'lucide-react';
import type { NowPlayingProps } from '../../dashboard/props';
import { useT } from '../../i18n/translate';
import { Artwork } from '../TrackImages';
import { useRollAcross } from './rollAcross';

/**
 * The song playing, in a card under the clock (TabBar): its cover, title and artist, play or pause and skip, and a line
 * in the chosen colour for how far through it is. A title too long for the card rolls across every so often, like the
 * Dashboard's other long lines.
 */
export default function NowPlaying({
  title,
  artist,
  artUrl,
  isPlaying,
  progress,
  controlsEnabled,
  onPlayPause,
  onNext
}: Readonly<NowPlayingProps>) {
  const t = useT();
  const titleRef = useRollAcross();
  const done = Math.min(1, Math.max(0, progress));
  return (
    <section className="dashboard-now-playing" aria-label={t('dashboard.now_playing')}>
      <Artwork src={artUrl ?? undefined} alt="" className="dashboard-now-playing-art" />
      <div className="dashboard-now-playing-text">
        <span className="dashboard-now-playing-title">
          <span ref={titleRef} className="dashboard-now-playing-title-text">
            {title}
          </span>
        </span>
        {artist && <span className="dashboard-now-playing-artist">{artist}</span>}
      </div>
      <div className="dashboard-now-playing-controls">
        <button
          type="button"
          className="dashboard-now-playing-play"
          aria-label={t(isPlaying ? 'dashboard.pause' : 'dashboard.play')}
          disabled={!controlsEnabled}
          onClick={() => void onPlayPause()}
        >
          {isPlaying ? (
            <Pause fill="currentColor" aria-hidden="true" />
          ) : (
            <Play fill="currentColor" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          aria-label={t('dashboard.next')}
          disabled={!controlsEnabled}
          onClick={() => void onNext()}
        >
          <SkipForward fill="currentColor" aria-hidden="true" />
        </button>
      </div>
      <span className="dashboard-now-playing-progress" aria-hidden="true">
        <span style={{ transform: `scaleX(${done})` }} />
      </span>
    </section>
  );
}
