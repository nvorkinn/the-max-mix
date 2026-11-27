/** Shared types for the Spotify data the app reads. */

/** A track in Spotify playback or the queue. */
export interface Track {
  id?: string;
  title?: string;
  name?: string;
  artist?: string;
  albumArt?: string;
  duration_ms?: number;
  album?: { images?: { url?: string }[] };
  artists?: { name?: string }[];
  uri?: string;
  external_urls?: { spotify?: string };
}

/** A Spotify Connect device. */
export interface SpotifyDevice {
  /** Null for a device Spotify lists but cannot address, so it cannot be selected. */
  id: string | null;
  name: string;
  type?: string;
  is_active?: boolean;
  is_restricted?: boolean;
  volume_percent?: number | null;
  supports_volume?: boolean;
}

/** Something the music picker can start: a playlist, Liked Songs, or a recently played track. */
export interface MusicChoice {
  /** A playlist or Liked Songs context, or a track. */
  uri: string;
  name: string;
  /** A second line: the owner, the artists. */
  detail?: string;
  image?: string;
  /** For a track: the album or playlist it was played from, to carry on from there. */
  contextUri?: string;
}

/** Spotify's repeat setting: off, the whole album or playlist, or the one track. */
export type RepeatMode = 'off' | 'context' | 'track';

/** The playback state, as `getPlaybackState()` returns it (and as the hook keeps it). */
export interface PlaybackState {
  is_playing?: boolean;
  device?: SpotifyDevice;
  item?: Track;
  track_window?: { current_track?: Track };
  progress_ms?: number;
  position?: number;
  duration?: number;
  shuffle_state?: boolean;
  repeat_state?: RepeatMode;
  actions?: {
    disallows?: {
      seeking?: boolean;
      skipping_prev?: boolean;
      skipping_next?: boolean;
      pausing?: boolean;
      resuming?: boolean;
      toggling_shuffle?: boolean;
      toggling_repeat_context?: boolean;
      toggling_repeat_track?: boolean;
    };
  };
}

/** Playback controls used by AlbumArtPlayer. */
export interface PlayerControls {
  playback: PlaybackState | null | undefined;
  isPlaying: boolean;
  onPlayPause: () => unknown;
  onNext: () => unknown;
  onPrevious: () => unknown;
  onSeek: (positionMs: number) => unknown;
  onVolumeChange?: (volumePercent: number) => unknown;
  onToggleShuffle?: () => unknown;
  onCycleRepeat?: () => unknown;
}
