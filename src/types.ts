/** Shared types for the Spotify data the app reads and the Web Playback SDK parts it uses. */

/** Error thrown by the Spotify calls (see spotify/api). */
export type ApiError = Error & { status?: number; retryAfter?: number };

/** A track in the party queue, in a search result or in Spotify playback. */
export interface Track {
  id?: string;
  title?: string;
  name?: string;
  artist?: string;
  albumArt?: string;
  duration_ms?: number;
  votes?: number;
  addedBy?: { avatar?: string; name?: string };
  added_by?: { avatar?: string; name?: string };
  album?: { images?: { url?: string }[] };
  artists?: { name?: string }[];
  uri?: string;
  external_urls?: { spotify?: string };
}

/** A Spotify Connect device. */
export interface SpotifyDevice {
  id: string;
  name: string;
  type?: string;
  is_active?: boolean;
  is_restricted?: boolean;
  volume_percent?: number | null;
  supports_volume?: boolean;
}

/** The playback state, as `getPlaybackState()` returns it (and as the hook keeps it). */
export interface PlaybackState {
  is_playing?: boolean;
  device?: SpotifyDevice;
  item?: Track;
  track_window?: { current_track?: Track };
  progress_ms?: number;
  position?: number;
  duration?: number;
  actions?: {
    disallows?: {
      seeking?: boolean;
      skipping_prev?: boolean;
      skipping_next?: boolean;
      pausing?: boolean;
      resuming?: boolean;
    };
  };
}

/** The guest who requested or upvoted a track. */
export interface Guest {
  id: string;
  name: string;
  avatar?: string;
}

/** Response of `getQueue()` and `reorderDemoQueue()`. */
export interface QueueResponse {
  queue: Track[];
}

/** Response of `playDemoTrackNow()`. */
export interface PlayNowResponse {
  remainingQueue: Track[];
}

/** Response of `getDevices()`. */
export interface DevicesResponse {
  devices?: SpotifyDevice[];
}

/**
 * What the Web Playback SDK reports on `player_state_changed` (null when this player is no longer the active device).
 */
export type SdkPlaybackState = {
  paused: boolean;
  position: number;
  duration?: number;
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

/** Player props shared by AlbumArtPlayer and VinylPlayer. */
export interface PlayerControls {
  playback: PlaybackState | null | undefined;
  isPlaying: boolean;
  onPlayPause: () => unknown;
  onNext: () => unknown;
  onPrevious: () => unknown;
  onSeek: (positionMs: number) => unknown;
  onVolumeChange?: (volumePercent: number) => unknown;
}
