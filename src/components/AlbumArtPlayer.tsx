import { useState } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  Speaker,
  ChevronUp,
  Shuffle,
  Repeat,
  Repeat1,
  RotateCcw,
  RotateCw
} from 'lucide-react';
import type { CSSProperties } from 'react';
import type { PlayerControls } from '../types';
import { Artwork } from './TrackImages';

type AlbumArtPlayerProps = Readonly<PlayerControls> & {
  controlsEnabled?: boolean;
  /** What the device indicator names as playing; defaults to the playing device's name. */
  speakerLabel?: string | undefined;
  /** Whether the speakers drawer the indicator opens is open. */
  speakersOpen?: boolean;
  /** Makes the indicator a button that opens the speakers drawer. */
  onOpenSpeakers?: () => void;
};

/** Past this far into a song, Previous starts the song over instead of going to the one before it. */
const RESTART_AFTER_MS = 5000;
/** How far the rewind and fast-forward buttons jump. */
const JUMP_MS = 15_000;

export default function AlbumArtPlayer({
  playback,
  isPlaying,
  onPlayPause,
  onNext,
  onPrevious,
  onSeek,
  onVolumeChange,
  onToggleShuffle,
  onCycleRepeat,
  controlsEnabled = false,
  speakerLabel,
  speakersOpen = false,
  onOpenSpeakers
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

  // Like most players: well into a song, Previous replays it from the start; near the start it goes back a song.
  const previous = () => {
    if (progressMs > RESTART_AFTER_MS && !playback?.actions?.disallows?.seeking) onSeek(0);
    else onPrevious();
  };

  const canSeek = controlsEnabled && durationMs > 0 && !playback?.actions?.disallows?.seeking;
  // Past the end clamps to the end, which moves Spotify on to the next song by itself.
  const jump = (offsetMs: number) => onSeek(Math.min(durationMs, Math.max(0, progressMs + offsetMs)));

  const deviceName = speakerLabel ?? playback?.device?.name;
  const speakerState = deviceName ? `Playing on ${deviceName}` : 'Select a device';
  const speakerAriaLabel = `Speakers: ${speakerState}`;
  const deviceText = deviceName ? (
    <>
      Playing on <b>{deviceName}</b>
    </>
  ) : (
    <b>Select a device</b>
  );

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const disallows = playback?.actions?.disallows;
  const shuffleOn = Boolean(playback?.shuffle_state);
  const repeatMode = playback?.repeat_state ?? 'off';
  const repeatLabel = { off: 'Repeat off', context: 'Repeat all', track: 'Repeat one' }[repeatMode];
  const elapsedTime = hasTrack ? formatTime(progressMs) : '--:--';
  const totalTime = durationMs > 0 ? formatTime(durationMs) : '--:--';

  return (
    <div className="now-playing">
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
          {artist && <p title={artist}>{artist}</p>}
        </div>
      </div>

      <div className="player-controls">
        <div className="seek-control">
          <span className="track-time">{elapsedTime}</span>
          <input
            type="range"
            disabled={!canSeek}
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
        {onOpenSpeakers ? (
          <button
            type="button"
            className={`player-device${speakersOpen ? ' is-open' : ''}`}
            onClick={onOpenSpeakers}
            aria-haspopup="dialog"
            aria-expanded={speakersOpen}
            aria-label={speakerAriaLabel}
          >
            <Speaker size={14} aria-hidden="true" />
            <span>{deviceText}</span>
            <ChevronUp size={14} className="player-device-chevron" aria-hidden="true" />
          </button>
        ) : (
          <div className="player-device">
            <Speaker size={14} aria-hidden="true" />
            <span>{deviceText}</span>
          </div>
        )}
        <div className="transport-row">
          <div className="transport-buttons">
            {onToggleShuffle && (
              <button
                type="button"
                disabled={!controlsEnabled || !hasTrack || disallows?.toggling_shuffle}
                className={`transport-skip transport-mode${shuffleOn ? ' is-on' : ''}`}
                onClick={onToggleShuffle}
                aria-label="Shuffle"
                aria-pressed={shuffleOn}
              >
                <Shuffle size={22} />
              </button>
            )}
            <button
              type="button"
              disabled={!canSeek}
              className="transport-skip transport-seek"
              onClick={() => jump(-JUMP_MS)}
              aria-label="Back 15 seconds"
              title="Back 15 seconds"
            >
              <RotateCcw size={26} aria-hidden="true" />
              <span aria-hidden="true">15</span>
            </button>
            <button
              type="button"
              disabled={!controlsEnabled || !hasTrack || playback?.actions?.disallows?.skipping_prev}
              className="transport-skip"
              onClick={previous}
              aria-label="Previous track"
            >
              <SkipBack size={24} fill="currentColor" />
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
              {isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" />}
            </button>
            <button
              type="button"
              disabled={!controlsEnabled || !hasTrack || playback?.actions?.disallows?.skipping_next}
              className="transport-skip"
              onClick={onNext}
              aria-label="Next track"
            >
              <SkipForward size={24} fill="currentColor" />
            </button>
            <button
              type="button"
              disabled={!canSeek}
              className="transport-skip transport-seek"
              onClick={() => jump(JUMP_MS)}
              aria-label="Forward 15 seconds"
              title="Forward 15 seconds"
            >
              <RotateCw size={26} aria-hidden="true" />
              <span aria-hidden="true">15</span>
            </button>
            {onCycleRepeat && (
              <button
                type="button"
                disabled={
                  !controlsEnabled ||
                  !hasTrack ||
                  (disallows?.toggling_repeat_context && disallows.toggling_repeat_track)
                }
                className={`transport-skip transport-mode${repeatMode === 'off' ? '' : ' is-on'}`}
                onClick={onCycleRepeat}
                aria-label={repeatLabel}
                title={repeatLabel}
              >
                {repeatMode === 'track' ? <Repeat1 size={22} /> : <Repeat size={22} />}
              </button>
            )}
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
