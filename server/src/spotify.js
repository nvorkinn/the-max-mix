import { mkdir, readFile, writeFile, rename, chmod, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

// A sign-in must finish within this long, and at most this many can be waiting, so abandoned ones cannot pile up.
const SIGN_IN_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_SIGN_INS = 20;

/**
 * The parts of Spotify's Web API responses that this app reads.
 * @typedef {{ id: string, name: string, artists: { name: string }[], duration_ms: number, album: { images: { url: string }[] } }} SpotifyTrack
 * @typedef {{ id: string, name: string, is_active: boolean, volume_percent: number | null, supports_volume: boolean }} SpotifyDevice
 * @typedef {{ is_playing: boolean, progress_ms: number | null, device: SpotifyDevice, item: SpotifyTrack | null }} SpotifyPlaybackState
 * @typedef {{ currently_playing: SpotifyTrack | null, queue: SpotifyTrack[] }} SpotifyQueue
 * @typedef {{ devices: SpotifyDevice[] }} SpotifyDevices
 * @typedef {{ access_token?: string, refresh_token?: string, expires_in?: number, error?: string }} SpotifyTokenResponse
 */

export class SpotifyError extends Error {
  /**
   * @param {string} message
   * @param {number} [status]
   * @param {string | null} [retryAfter]
   */
  constructor(message, status = 502, retryAfter = null) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export class SpotifyService {
  /**
   * @param {{ clientId: string, redirectUri: string, dataDir: string, fetchImpl?: typeof fetch }} options
   */
  constructor({ clientId, redirectUri, dataDir, fetchImpl = fetch }) {
    this.clientId = clientId;
    this.redirectUri = redirectUri;
    this.tokenFile = path.join(dataDir, 'spotify-token.json');
    this.fetch = fetchImpl;
    /** @type {string | null} */
    this.accessToken = null;
    /** @type {string | null} */
    this.refreshToken = null;
    this.tokenExpiresAt = 0;
    /** @type {Promise<string> | null} */
    this.refreshPromise = null;
    /** PKCE code verifiers of sign-ins that have started, by OAuth state. @type {Map<string, { verifier: string, expiresAt: number }>} */
    this.pendingSignIns = new Map();
  }

  async initialize() {
    try {
      /** @type {{ clientId?: unknown, refreshToken?: unknown }} */
      const stored = JSON.parse(await readFile(this.tokenFile, 'utf8'));
      if (stored.clientId !== this.clientId) {
        throw new Error('Saved Spotify login belongs to another app. Remove spotify-token.json and sign in again.');
      }
      if (typeof stored.refreshToken !== 'string' || !stored.refreshToken) {
        throw new Error('Saved Spotify login is invalid. Remove spotify-token.json and sign in again.');
      }
      await chmod(this.tokenFile, 0o600);
      this.refreshToken = stored.refreshToken;
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
    }
  }

  isConfigured() {
    return Boolean(this.clientId);
  }

  isAuthenticated() {
    return Boolean(this.accessToken || this.refreshToken);
  }

  /**
   * Starts a sign-in with PKCE (RFC 7636): the server keeps a random code verifier and sends only its SHA-256 hash to
   * Spotify, then proves it holds the verifier when exchanging the code. This replaces the client secret, so the app
   * has nothing secret to deploy.
   * @param {string} state
   */
  getAuthUrl(state) {
    if (!this.isConfigured()) {
      throw new SpotifyError('Configure SPOTIFY_CLIENT_ID before signing in.', 400);
    }
    const now = Date.now();
    for (const [pendingState, pending] of this.pendingSignIns) {
      if (pending.expiresAt <= now) this.pendingSignIns.delete(pendingState);
    }
    if (this.pendingSignIns.size >= MAX_PENDING_SIGN_INS) {
      // Map keys are in insertion order, so this drops the oldest.
      this.pendingSignIns.delete(/** @type {string} */ (this.pendingSignIns.keys().next().value));
    }
    const verifier = randomBytes(64).toString('base64url');
    this.pendingSignIns.set(state, { verifier, expiresAt: now + SIGN_IN_TTL_MS });
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      state,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      scope:
        'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state user-read-currently-playing'
    });
    return `https://accounts.spotify.com/authorize?${params}`;
  }

  /** @param {string} refreshToken */
  async storeRefreshToken(refreshToken) {
    await mkdir(path.dirname(this.tokenFile), { recursive: true, mode: 0o700 });
    const temporaryFile = `${this.tokenFile}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryFile, JSON.stringify({ clientId: this.clientId, refreshToken }), { mode: 0o600 });
      await rename(temporaryFile, this.tokenFile);
    } finally {
      await unlink(temporaryFile).catch((/** @type {NodeJS.ErrnoException} */ error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }

  /**
   * @param {Record<string, string>} parameters
   * @returns {Promise<string>}
   */
  async exchangeToken(parameters) {
    const response = await this.fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, ...parameters })
    });
    if (!response.ok) {
      if (response.status === 400 && parameters.grant_type === 'refresh_token') {
        /** @type {SpotifyTokenResponse} */
        const data = await response.json().catch(() => ({}));
        if (data.error === 'invalid_grant') {
          await unlink(this.tokenFile).catch((/** @type {NodeJS.ErrnoException} */ error) => {
            if (error.code !== 'ENOENT') throw error;
          });
          this.accessToken = null;
          this.refreshToken = null;
          throw new SpotifyError('Spotify login expired or was revoked. Sign in again in Settings.', 401);
        }
      }
      throw new SpotifyError(
        `Spotify authentication failed (${response.status}). Check SPOTIFY_CLIENT_ID and the redirect URI, then sign in again.`,
        502
      );
    }
    /** @type {SpotifyTokenResponse} */
    const data = await response.json();
    if (!data.access_token || data.expires_in === undefined || !Number.isFinite(data.expires_in)) {
      throw new SpotifyError('Spotify returned an invalid token response.');
    }
    const refreshToken = data.refresh_token || this.refreshToken;
    if (!refreshToken) throw new SpotifyError('Spotify did not provide a refresh token. Sign in again.');
    await this.storeRefreshToken(refreshToken);
    this.refreshToken = refreshToken;
    const accessToken = data.access_token;
    this.accessToken = accessToken;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000 - 60000;
    return accessToken;
  }

  /**
   * @param {string} code
   * @param {string} state the OAuth state the sign-in was started with
   */
  async handleAuthCallback(code, state) {
    const pending = this.pendingSignIns.get(state);
    // A verifier is good for one exchange: remove it before using it, so a replayed callback cannot reuse it.
    this.pendingSignIns.delete(state);
    if (!pending || pending.expiresAt <= Date.now()) {
      throw new SpotifyError('Spotify sign-in expired or was not started here. Start again from Settings.', 400);
    }
    return this.exchangeToken({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
      code_verifier: pending.verifier
    });
  }

  async getValidAccessToken() {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) return this.accessToken;
    if (!this.refreshToken) return null;
    if (!this.refreshPromise) {
      this.refreshPromise = this.exchangeToken({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken
      }).finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  /**
   * @param {string} endpoint
   * @param {RequestInit} [options]
   * @param {boolean} [retry]
   * @returns {Promise<unknown>} the parsed Spotify response, or null for 204; callers narrow it to the endpoint's shape
   */
  async spotifyFetch(endpoint, options = {}, retry = true) {
    const token = await this.getValidAccessToken();
    if (!token) throw new SpotifyError('Sign in to Spotify in Settings to control playback.', 401);
    const response = await this.fetch(`https://api.spotify.com/v1${endpoint}`, {
      ...options,
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        .../** @type {Record<string, string> | undefined} */ (options.headers)
      }
    });
    if (response.status === 401 && retry && this.refreshToken) {
      this.tokenExpiresAt = 0;
      return this.spotifyFetch(endpoint, options, false);
    }
    if (response.status === 204) return null;
    if (!response.ok) {
      /** @type {Record<number, string>} */
      const messages = {
        401: 'Spotify authorization failed. Sign in again in Settings.',
        403: 'Spotify denied this action. Check Premium, app access, and device restrictions.',
        404: 'No available Spotify device. Open Spotify on a speaker or phone, then select it here.',
        429: 'Spotify rate limit reached. Wait before trying again.'
      };
      throw new SpotifyError(
        messages[response.status] || `Spotify request failed (${response.status}).`,
        response.status,
        response.headers.get('retry-after')
      );
    }
    return response.json();
  }

  /**
   * @param {string} deviceId
   * @param {boolean} [play]
   */
  transferPlayback(deviceId, play = false) {
    return this.spotifyFetch('/me/player', { method: 'PUT', body: JSON.stringify({ device_ids: [deviceId], play }) });
  }

  /** @returns {Promise<SpotifyQueue | null>} */
  getQueue() {
    return /** @type {Promise<SpotifyQueue | null>} */ (this.spotifyFetch('/me/player/queue'));
  }
  /** @returns {Promise<SpotifyPlaybackState | null>} */
  getPlaybackState() {
    return /** @type {Promise<SpotifyPlaybackState | null>} */ (this.spotifyFetch('/me/player'));
  }
  /** @returns {Promise<SpotifyDevices | null>} */
  getDevices() {
    return /** @type {Promise<SpotifyDevices | null>} */ (this.spotifyFetch('/me/player/devices'));
  }
  play() {
    return this.spotifyFetch('/me/player/play', { method: 'PUT' });
  }
  pause() {
    return this.spotifyFetch('/me/player/pause', { method: 'PUT' });
  }
  next() {
    return this.spotifyFetch('/me/player/next', { method: 'POST' });
  }
  previous() {
    return this.spotifyFetch('/me/player/previous', { method: 'POST' });
  }
  /** @param {number} position */
  seek(position) {
    return this.spotifyFetch(`/me/player/seek?position_ms=${position}`, { method: 'PUT' });
  }
  /** @param {number} volume */
  setVolume(volume) {
    return this.spotifyFetch(`/me/player/volume?volume_percent=${volume}`, { method: 'PUT' });
  }
}
