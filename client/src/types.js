/**
 * Shared JSDoc typedefs. This module has no runtime exports; import the types with
 * `import('../types.js').Track` in JSDoc comments.
 */

/**
 * Error thrown by the Spotify calls (see spotify/api.js).
 * @typedef {Error & { status?: number, retryAfter?: number }} ApiError
 */

/**
 * A track in the party queue, in a search result or in Spotify playback.
 * @typedef {object} Track
 * @property {string} [id]
 * @property {string} [title]
 * @property {string} [name]
 * @property {string} [artist]
 * @property {string} [albumArt]
 * @property {number} [duration_ms]
 * @property {number} [votes]
 * @property {{ avatar?: string, name?: string }} [addedBy]
 * @property {{ avatar?: string, name?: string }} [added_by]
 * @property {{ images?: { url?: string }[] }} [album]
 * @property {{ name?: string }[]} [artists]
 * @property {string} [uri]
 * @property {{ spotify?: string }} [external_urls]
 */

/**
 * A Spotify Connect device.
 * @typedef {object} SpotifyDevice
 * @property {string} id
 * @property {string} name
 * @property {string} [type]
 * @property {boolean} [is_active]
 * @property {boolean} [is_restricted]
 * @property {number | null} [volume_percent]
 * @property {boolean} [supports_volume]
 */

/**
 * The playback state, as `getPlaybackState()` returns it (and as the hook keeps it).
 * @typedef {object} PlaybackState
 * @property {boolean} [is_playing]
 * @property {SpotifyDevice} [device]
 * @property {Track} [item]
 * @property {{ current_track?: Track }} [track_window]
 * @property {number} [progress_ms]
 * @property {number} [position]
 * @property {number} [duration]
 * @property {{ disallows?: { seeking?: boolean, skipping_prev?: boolean, skipping_next?: boolean, pausing?: boolean, resuming?: boolean } }} [actions]
 */

/**
 * The guest who requested or upvoted a track.
 * @typedef {object} Guest
 * @property {string} id
 * @property {string} name
 * @property {string} [avatar]
 */

/**
 * Response of `getQueue()` and `reorderDemoQueue()`.
 * @typedef {object} QueueResponse
 * @property {Track[]} queue
 */

/**
 * Response of `playDemoTrackNow()`.
 * @typedef {object} PlayNowResponse
 * @property {Track[]} remainingQueue
 */

/**
 * Response of `getDevices()`.
 * @typedef {object} DevicesResponse
 * @property {SpotifyDevice[]} [devices]
 */

/**
 * The part of the Spotify Web Playback SDK player that the app uses.
 * @typedef {object} SpotifyPlayer
 * @property {(event: string, listener: (payload: never) => void) => unknown} addListener
 * @property {() => Promise<boolean>} connect
 * @property {() => unknown} disconnect
 * @property {() => Promise<void>} togglePlay
 * @property {() => Promise<void>} nextTrack
 * @property {() => Promise<void>} previousTrack
 * @property {(positionMs: number) => Promise<void>} seek
 * @property {(volume: number) => Promise<void>} setVolume
 * @property {() => Promise<void>} activateElement
 * @property {() => Promise<SdkPlaybackState>} getCurrentState
 */

/**
 * What the Web Playback SDK reports on `player_state_changed` (null when this player is no longer the active device).
 * @typedef {{
 *   paused: boolean,
 *   position: number,
 *   duration?: number,
 *   track_window?: { current_track?: Track, next_tracks?: { id?: string | null, uri?: string }[] }
 * } | null} SdkPlaybackState
 */

/**
 * The `Spotify` namespace that the Web Playback SDK script puts on `window`.
 * @typedef {object} SpotifySdk
 * @property {new (options: {
 *   name: string,
 *   getOAuthToken: (callback: (token: string) => void) => void,
 *   volume?: number
 * }) => SpotifyPlayer} Player
 */

/**
 * Player props shared by AlbumArtPlayer and VinylPlayer.
 * @typedef {object} PlayerControls
 * @property {PlaybackState | null | undefined} playback
 * @property {boolean} isPlaying
 * @property {() => unknown} onPlayPause
 * @property {() => unknown} onNext
 * @property {() => unknown} onPrevious
 * @property {(positionMs: number) => unknown} onSeek
 * @property {(volumePercent: number) => unknown} [onVolumeChange]
 */

export {};
