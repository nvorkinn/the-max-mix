/** Shared types for the Spotify data the app reads and the Web Playback SDK parts it uses. */

/** A track in Spotify playback or the queue. */
export interface Track {
  id?: string;
  title?: string;
  name?: string;
  artist?: string;
  albumArt?: string;
  duration_ms?: number;
  album?: { name?: string; images?: { url?: string }[] };
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

/** The album, playlist, artist or Liked Songs that playback runs through. */
export interface PlaybackContext {
  uri: string;
  /** Spotify's kind of context: album, playlist, artist, show, or collection (Liked Songs). */
  type?: string;
  /** Its name, when Spotify sent one (the SDK may; the Web API never does). */
  name?: string;
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
  context?: PlaybackContext;
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

/**
 * What the Web Playback SDK reports on `player_state_changed` (null when this player is no longer the active device).
 */
export type SdkPlaybackState = {
  paused: boolean;
  position: number;
  duration?: number;
  shuffle?: boolean;
  /** 0 off, 1 the album or playlist, 2 the track. */
  repeat_mode?: number;
  /** A null uri means the track plays on its own, not from an album or playlist. */
  context?: { uri?: string | null; metadata?: { name?: unknown; context_description?: unknown } | null } | null;
  track_window?: { current_track?: Track; next_tracks?: { id?: string | null; uri?: string }[] };
} | null;

/** The part of the Spotify Web Playback SDK player that the app uses. */
export interface SpotifyPlayer {
  addListener: (event: string, listener: (payload: never) => void) => unknown;
  connect: () => Promise<boolean>;
  disconnect: () => unknown;
  togglePlay: () => Promise<void>;
  nextTrack: () => Promise<void>;
  previousTrack: () => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  activateElement: () => Promise<void>;
  getCurrentState: () => Promise<SdkPlaybackState>;
}

/** The `Spotify` namespace that the Web Playback SDK script puts on `window`. */
export interface SpotifySdk {
  Player: new (options: {
    name: string;
    getOAuthToken: (callback: (token: string) => void) => void;
    volume?: number;
  }) => SpotifyPlayer;
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
  /** Whether the current track is in Liked Songs; null while unknown (then the heart is disabled). */
  liked?: boolean | null;
  onToggleLike?: () => unknown;
}
