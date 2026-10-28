import { mkdir, readFile, writeFile, rename, chmod, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class SpotifyError extends Error {
  constructor(message, status = 502, retryAfter = null) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export class SpotifyService {
  constructor({ clientId, clientSecret, redirectUri, dataDir, fetchImpl = fetch }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.tokenFile = path.join(dataDir, 'spotify-token.json');
    this.fetch = fetchImpl;
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiresAt = 0;
    this.refreshPromise = null;
  }

  async initialize() {
    try {
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
      if (error.code !== 'ENOENT') throw error;
    }
  }

  isConfigured() {
    return Boolean(this.clientId && this.clientSecret);
  }

  isAuthenticated() {
    return Boolean(this.accessToken || this.refreshToken);
  }

  getAuthUrl(state) {
    if (!this.isConfigured()) {
      throw new SpotifyError('Configure SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET before signing in.', 400);
    }
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      state,
      scope:
        'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state user-read-currently-playing'
    });
    return `https://accounts.spotify.com/authorize?${params}`;
  }

  async storeRefreshToken(refreshToken) {
    await mkdir(path.dirname(this.tokenFile), { recursive: true, mode: 0o700 });
    const temporaryFile = `${this.tokenFile}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryFile, JSON.stringify({ clientId: this.clientId, refreshToken }), { mode: 0o600 });
      await rename(temporaryFile, this.tokenFile);
    } finally {
      await unlink(temporaryFile).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }

  async exchangeToken(parameters) {
    const response = await this.fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(parameters)
    });
    if (!response.ok) {
      if (response.status === 400 && parameters.grant_type === 'refresh_token') {
        const data = await response.json().catch(() => ({}));
        if (data.error === 'invalid_grant') {
          await unlink(this.tokenFile).catch(error => {
            if (error.code !== 'ENOENT') throw error;
          });
          this.accessToken = null;
          this.refreshToken = null;
          throw new SpotifyError('Spotify login expired or was revoked. Sign in again in Settings.', 401);
        }
      }
      throw new SpotifyError(
        `Spotify authentication failed (${response.status}). Check your app credentials and sign in again.`,
        502
      );
    }
    const data = await response.json();
    if (!data.access_token || !Number.isFinite(data.expires_in)) {
      throw new SpotifyError('Spotify returned an invalid token response.');
    }
    const refreshToken = data.refresh_token || this.refreshToken;
    if (!refreshToken) throw new SpotifyError('Spotify did not provide a refresh token. Sign in again.');
    await this.storeRefreshToken(refreshToken);
    this.refreshToken = refreshToken;
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000 - 60000;
    return this.accessToken;
  }

  async handleAuthCallback(code) {
    return this.exchangeToken({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri });
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

  async spotifyFetch(endpoint, options = {}, retry = true) {
    const token = await this.getValidAccessToken();
    if (!token) throw new SpotifyError('Sign in to Spotify in Settings to control playback.', 401);
    const response = await this.fetch(`https://api.spotify.com/v1${endpoint}`, {
      ...options,
      signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers }
    });
    if (response.status === 401 && retry && this.refreshToken) {
      this.tokenExpiresAt = 0;
      return this.spotifyFetch(endpoint, options, false);
    }
    if (response.status === 204) return null;
    if (!response.ok) {
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

  transferPlayback(deviceId, play = false) {
    return this.spotifyFetch('/me/player', { method: 'PUT', body: JSON.stringify({ device_ids: [deviceId], play }) });
  }

  getQueue() {
    return this.spotifyFetch('/me/player/queue');
  }
  getPlaybackState() {
    return this.spotifyFetch('/me/player');
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
  seek(position) {
    return this.spotifyFetch(`/me/player/seek?position_ms=${position}`, { method: 'PUT' });
  }
  setVolume(volume) {
    return this.spotifyFetch(`/me/player/volume?volume_percent=${volume}`, { method: 'PUT' });
  }
}
