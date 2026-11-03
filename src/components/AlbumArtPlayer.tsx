import { useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, Speaker, MicVocal, Image } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import type { PlayerControls } from '../types';
import { Artwork } from './TrackImages';

type AlbumArtPlayerProps = Readonly<PlayerControls> & {
  controlsEnabled?: boolean;
  /** Synced lyrics shown in place of the artwork while `lyricsOpen`. */
  lyrics?: ReactNode;
  lyricsOpen?: boolean;
  onToggleLyrics?: () => void;
};

export default function AlbumArtPlayer({
  playback,
  isPlaying,
  onPlayPause,
  onNext,
  onPrevious,
  onSeek,
  onVolumeChange,
  controlsEnabled = false,
  lyrics,
  lyricsOpen = false,
  onToggleLyrics
}: AlbumArtPlayerProps) {
  // Local slider value, reset whenever the device reports a different volume (adjusted during render, not in an effect).
  const deviceVolume = playback?.device?.volume_percent ?? 0;
  const [volume, setVolume] = useState(deviceVolume);
  const [syncedDeviceVolume, setSyncedDeviceVolume] = useState(deviceVolume);
  if (syncedDeviceVolume !== deviceVolume) {
    setSyncedDeviceVolume(deviceVolume);
    setVolume(deviceVolume);
  }
  const volumeEnabled =
    controlsEnabled && playback?.device?.supports_volume !== false && playback?.device?.volume_percent != null;
  const item = playback?.item ?? playback?.track_window?.current_track ?? {};
  const hasTrack = Boolean(item.id || item.uri || item.name || item.title);
  const title = item.name || item.title || 'Nothing playing';
  const artist = item.artists ? item.artists.map(a => a.name).join(', ') : item.artist || '';
  const albumArt = item.album?.images?.[0]?.url || item.albumArt;
  const progressMs = hasTrack ? (playback?.progress_ms ?? playback?.position ?? 0) : 0;
  const durationMs = hasTrack ? item.duration_ms || playback?.duration || 0 : 0;
  const progressPercent = durationMs > 0 ? Math.min(100, Math.max(0, (progressMs / durationMs) * 100)) : 0;

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const elapsedTime = hasTrack ? formatTime(progressMs) : '--:--';
  const totalTime = durationMs > 0 ? formatTime(durationMs) : '--:--';

  return (
    <div className="now-playing">
      <div className="album-art">
        {lyricsOpen && onToggleLyrics ? (
          <>
            {lyrics}
            <button
              type="button"
              className="art-corner-button"
              onClick={onToggleLyrics}
              aria-label="Show artwork"
              title="Show artwork"
            >
              <Image size={18} />
            </button>
          </>
        ) : (
          <button
            type="button"
            className="art-toggle"
            onClick={onToggleLyrics}
            disabled={!onToggleLyrics}
            aria-label="Show lyrics"
            title="Show lyrics"
          >
            <Artwork src={albumArt} alt={`${title} album artwork`} className="album-cover" />
            {onToggleLyrics && (
              <span className="art-corner-button" aria-hidden="true">
                <MicVocal size={18} />
              </span>
            )}
          </button>
        )}
      </div>

      <div className="track-details">
        <div
          className="track-copy"
          role="region"
          aria-label="Track information"
          // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex -- Oversized metadata must remain keyboard-scrollable on the kiosk.
          tabIndex={0}
        >
          <h2 title={title}>{title}</h2>
          {artist && <p title={artist}>{artist}</p>}
        </div>
      </div>

      <div className="player-controls">
        <div className="seek-control">
          <span className="track-time">{elapsedTime}</span>
          <input
            type="range"
            disabled={!controlsEnabled || durationMs <= 0 || playback?.actions?.disallows?.seeking}
            min="0"
            max={durationMs || 1}
            value={Math.min(progressMs, durationMs)}
            onChange={e => onSeek(Number(e.target.value))}
            aria-label="Playback position"
            aria-valuetext={durationMs > 0 ? `${elapsedTime} of ${totalTime}` : 'Playback time unavailable'}
            className="range-control seek-range"
            style={{ '--range-progress': `${progressPercent}%` } as CSSProperties}
          />
          <span className="track-time">{totalTime}</span>
        </div>
        <div className="player-device">
          <Speaker size={14} aria-hidden="true" />
          <span>{playback?.device?.name || 'Select a device in Speakers'}</span>
        </div>
        <div className="transport-row">
          <div className="transport-buttons">
            <button
              type="button"
              disabled={!controlsEnabled || !hasTrack || playback?.actions?.disallows?.skipping_prev}
              className="transport-skip"
              onClick={onPrevious}
              aria-label="Previous track"
            >
              <SkipBack size={20} fill="currentColor" />
            </button>
            <button
              type="button"
              disabled={
                !controlsEnabled ||
                (isPlaying ? playback?.actions?.disallows?.pausing : playback?.actions?.disallows?.resuming)
              }
              className="transport-play"
              onClick={onPlayPause}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
            </button>
            <button
              type="button"
              disabled={!controlsEnabled || !hasTrack || playback?.actions?.disallows?.skipping_next}
              className="transport-skip"
              onClick={onNext}
              aria-label="Next track"
            >
              <SkipForward size={20} fill="currentColor" />
            </button>
          </div>
        </div>
        <label className="volume-control">
          <Volume2 size={16} aria-hidden="true" />
          <input
            type="range"
            disabled={!volumeEnabled}
            min="0"
            max="100"
            value={volume}
            aria-label="Volume"
            onChange={e => {
              const value = Number(e.target.value);
              setVolume(value);
              onVolumeChange?.(value);
            }}
            className="range-control volume-range"
            style={{ '--range-progress': `${volume}%` } as CSSProperties}
          />
        </label>
      </div>
    </div>
  );
}
