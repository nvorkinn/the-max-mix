import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import type { NowPlayingProps } from '../../dashboard/props';
import { Artwork } from '../TrackImages';

/**
 * The song playing, in a card hanging under the Spotify tab (TabBar): its cover, title and artist, back, play or pause
 * and skip, and a line in the chosen colour for how far through it is.
 */
export default function NowPlaying({
  title,
  artist,
  artUrl,
  isPlaying,
  progress,
  controlsEnabled,
  onPlayPause,
  onPrevious,
  onNext
}: Readonly<NowPlayingProps>) {
  const done = Math.min(1, Math.max(0, progress));
  return (
    <section className="dashboard-now-playing" aria-label="Now playing">
      <Artwork src={artUrl ?? undefined} alt="" className="dashboard-now-playing-art" />
      <div className="dashboard-now-playing-text">
        <span className="dashboard-now-playing-title">{title}</span>
        {artist && <span className="dashboard-now-playing-artist">{artist}</span>}
      </div>
      <div className="dashboard-now-playing-controls">
        <button type="button" aria-label="Previous" disabled={!controlsEnabled} onClick={() => void onPrevious()}>
          <SkipBack fill="currentColor" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="dashboard-now-playing-play"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          disabled={!controlsEnabled}
          onClick={() => void onPlayPause()}
        >
          {isPlaying ? (
            <Pause fill="currentColor" aria-hidden="true" />
          ) : (
            <Play fill="currentColor" aria-hidden="true" />
          )}
        </button>
        <button type="button" aria-label="Next" disabled={!controlsEnabled} onClick={() => void onNext()}>
          <SkipForward fill="currentColor" aria-hidden="true" />
        </button>
      </div>
      <span className="dashboard-now-playing-progress" aria-hidden="true">
        <span style={{ transform: `scaleX(${done})` }} />
      </span>
    </section>
  );
}
