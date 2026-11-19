import type { PlayerControls, PlaybackState } from '../types';
import type { NowPlayingProps } from './props';

/** Past this far into a song, Previous starts the song over instead of going to the one before it. */
const RESTART_AFTER_MS = 5000;

/** After a pause, how long the Dashboard keeps showing the song, so it can be played again from there. */
export const PAUSED_SHOWN_MS = 5 * 60_000;

/** The song `playback` holds, as Spotify's Web API (`item`) or its player in the page (`track_window`) gives it. */
function trackOf(playback: PlaybackState | null | undefined) {
  return playback?.item ?? playback?.track_window?.current_track;
}

/**
 * Like most players: well into a song, Previous replays it from the start; near the start it goes back a song. The
 * Spotify tab's player and the Dashboard's card both go back this way.
 */
export function goBack(
  playback: PlaybackState | null | undefined,
  onSeek: (positionMs: number) => unknown,
  onPrevious: () => unknown
) {
  const progressMs = playback?.progress_ms ?? playback?.position ?? 0;
  return progressMs > RESTART_AFTER_MS && !playback?.actions?.disallows?.seeking ? onSeek(0) : onPrevious();
}

/** What the Dashboard's card under the Spotify tab shows for `playback`, or null with no song to show. */
export function nowPlayingCard(
  playback: PlaybackState | null | undefined,
  controls: Pick<PlayerControls, 'onPlayPause' | 'onNext' | 'onPrevious' | 'onSeek'> & { controlsEnabled: boolean }
): NowPlayingProps | null {
  const track = trackOf(playback);
  const title = track?.name || track?.title;
  if (!track || !title) return null;
  const progressMs = playback?.progress_ms ?? playback?.position ?? 0;
  const durationMs = track.duration_ms || playback?.duration || 0;
  return {
    title,
    artist: track.artists ? track.artists.map(artist => artist.name).join(', ') : track.artist || '',
    artUrl: track.album?.images?.[0]?.url || track.albumArt || null,
    isPlaying: Boolean(playback?.is_playing),
    progress: durationMs > 0 ? progressMs / durationMs : 0,
    controlsEnabled: controls.controlsEnabled,
    onPlayPause: controls.onPlayPause,
    onNext: controls.onNext,
    onPrevious: () => goBack(playback, controls.onSeek, controls.onPrevious)
  };
}
