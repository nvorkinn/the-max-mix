import { useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, AudioLines, Speaker } from 'lucide-react';
import type { CSSProperties } from 'react';
import { getDivaForUser } from '../utils/divas';
import type { PlayerControls } from '../types';
import { Artwork, GuestAvatar } from './TrackImages';

type AlbumArtPlayerProps = Readonly<PlayerControls> & {
  theme?: string;
  isDemoMode?: boolean;
  controlsEnabled?: boolean;
};

export default function AlbumArtPlayer({
  playback,
  isPlaying,
  onPlayPause,
  onNext,
  onPrevious,
  onSeek,
  onVolumeChange,
  theme = 'neon',
  isDemoMode = false,
  controlsEnabled = false
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
  const title = item.name || item.title || 'Ready when you are';
  const artist = item.artists
    ? item.artists.map(a => a.name).join(', ')
    : item.artist || 'Choose your next favourite in Spotify';
  const albumArt = item.album?.images?.[0]?.url || item.albumArt;
  const progressMs = playback?.progress_ms ?? playback?.position ?? 0;
  const durationMs = item.duration_ms || playback?.duration || 180_000;
  const progressPercent = Math.min(100, Math.max(0, (progressMs / durationMs) * 100));
  const rawAddedBy = item.added_by ?? item.addedBy ?? {};
  const guestName = isDemoMode ? rawAddedBy.name : null;
  const assignedDiva = getDivaForUser(guestName || '', 0, theme);
  const userAvatar = rawAddedBy.avatar || assignedDiva.image;

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };

  return (
    <div className="now-playing">
      <div className="player-heading">
        <span className="eyebrow">
          <AudioLines size={14} /> Now playing
        </span>
      </div>

      <div className="album-art">
        <Artwork src={albumArt} alt={`${title} album artwork`} className="album-cover" />
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
          <p title={artist}>{artist}</p>
        </div>
        <div className="track-credit">
          <Speaker size={14} aria-hidden="true" />
          <span>{playback?.device?.name || 'Select a device in Speakers'}</span>
        </div>
        {guestName && (
          <div className="track-credit">
            <GuestAvatar src={userAvatar} name={guestName} />
            <span>
              Demo pick by <strong>{guestName}</strong>
            </span>
          </div>
        )}
      </div>

      <div className="player-controls">
        <div className="seek-control">
          <input
            type="range"
            disabled={!controlsEnabled || !item.duration_ms || playback?.actions?.disallows?.seeking}
            min="0"
            max={durationMs}
            value={Math.min(progressMs, durationMs)}
            onChange={e => onSeek(Number(e.target.value))}
            aria-label="Playback position"
            aria-valuetext={`${formatTime(progressMs)} of ${formatTime(durationMs)}`}
            className="range-control seek-range"
            style={{ '--range-progress': `${progressPercent}%` } as CSSProperties}
          />
          <div className="track-times">
            <span>{formatTime(progressMs)}</span>
            <span>{formatTime(durationMs)}</span>
          </div>
        </div>
        <div className="transport-row">
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
          <div className="transport-buttons">
            <button
              type="button"
              disabled={!controlsEnabled || playback?.actions?.disallows?.skipping_prev}
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
              disabled={!controlsEnabled || playback?.actions?.disallows?.skipping_next}
              className="transport-skip"
              onClick={onNext}
              aria-label="Next track"
            >
              <SkipForward size={20} fill="currentColor" />
            </button>
          </div>
          <span className="transport-status">
            <span className={`playback-equalizer ${isPlaying ? 'is-playing' : ''}`} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {isPlaying ? 'Playing' : 'Paused'}
          </span>
        </div>
      </div>
    </div>
  );
}
