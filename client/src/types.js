/**
 * Shared JSDoc typedefs. This module has no runtime exports; import the types with
 * `import('../types.js').Track` in JSDoc comments.
 */

/**
 * Error thrown by `requestJSON` / `postJSON` (see utils/api.js).
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
 */

/**
 * Response of `/api/spotify/current`.
 * @typedef {object} PlaybackState
 * @property {boolean} [is_playing]
 * @property {SpotifyDevice} [device]
 * @property {any} [item]
 * @property {number} [progress_ms]
 */

/**
 * Response of `/api/info`.
 * @typedef {object} ServerConfig
 * @property {boolean} [demoMode]
 * @property {boolean} [spotifyConfigured]
 * @property {string} [playbackMode]
 */

export {};
