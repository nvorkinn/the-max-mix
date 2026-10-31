// Spotify Web API calls made straight from the browser (Spotify allows CORS for them).

import type { PlaybackState, SpotifyDevice, Track } from '../types';
import { discardAccessToken, getAccessToken, isSignedIn } from './auth';
import { fetchSpotify, parseJson, readJson, SpotifyApiError } from './http';
import { isRecord, parseDevices, parsePlaybackState, parseQueue } from './parse';

export { SpotifyApiError } from './http';

const MESSAGES: Record<number, string> = {
  401: 'Spotify authorization failed. Sign in again in Settings.',
  403: 'Spotify denied this action. Check Premium, app access, and device restrictions.',
  404: 'No available Spotify device. Open Spotify on a speaker or phone, then select it here.',
  429: 'Spotify rate limit reached. Wait before trying again.'
};

/** Spotify's own explanation of a refused request, when it gave one ({"error": {"message": "..."}}). */
async function spotifyReason(response: Response): Promise<string> {
  try {
    const body = parseJson(await response.text());
    const message = isRecord(body) && isRecord(body['error']) ? body['error']['message'] : undefined;
    return typeof message === 'string' ? message : '';
  } catch {
    return '';
  }
}

/** Resolves to the parsed Spotify response for a GET, or null for 204 and for any player command. */
async function spotifyFetch(endpoint: string, options: { method?: string; body?: unknown } = {}): Promise<unknown> {
  const method = options.method ?? 'GET';
  const hasBody = options.body !== undefined;
  const send = async () => {
    const token = await getAccessToken();
    if (!token) throw new SpotifyApiError('Sign in to Spotify in Settings to control playback.', 401);
    return fetchSpotify(`https://api.spotify.com/v1${endpoint}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(hasBody && { 'Content-Type': 'application/json' }) },
      ...(hasBody && { body: JSON.stringify(options.body) })
    });
  };
  let response = await send();
  // A 401 may only mean the access token expired early: refresh it and try once more.
  if (response.status === 401 && isSignedIn()) {
    discardAccessToken();
    response = await send();
  }
  if (response.status === 204) return null;
  if (!response.ok) {
    const message = MESSAGES[response.status] || `Spotify request failed (${response.status}).`;
    // A 403 has several causes (Premium, app access, a command the player refuses); Spotify says which.
    const reason = response.status === 403 ? await spotifyReason(response) : '';
    const retryAfter = Math.ceil(Number(response.headers.get('retry-after')));
    throw new SpotifyApiError(
      reason ? `${message} Spotify says: ${reason}` : message,
      response.status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 0
    );
  }
  // A player command (anything but a read) answers 204, or 200 with an opaque id as plain text: its body is not
  // data, and parsing it as JSON would turn a command that worked into an error.
  return method === 'GET' ? readJson(response) : null;
}

async function command(endpoint: string, method: string, body?: unknown): Promise<{ success: true }> {
  await spotifyFetch(endpoint, { method, body });
  return { success: true };
}

function requireInteger(value: unknown, min: number, max: number, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new SpotifyApiError(`${label} must be an integer between ${min} and ${max}.`, 400);
  }
}

/** Resolves to null when nothing is playing anywhere. */
export async function getPlaybackState(): Promise<PlaybackState | null> {
  return parsePlaybackState(await spotifyFetch('/me/player'));
}

export async function getQueue(): Promise<{ currently_playing: Track | null; queue: Track[] }> {
  return parseQueue(await spotifyFetch('/me/player/queue'));
}

export async function getDevices(): Promise<{ devices: SpotifyDevice[] }> {
  return parseDevices(await spotifyFetch('/me/player/devices'));
}

export async function transferPlayback(deviceId: string, startPlaying = false): Promise<{ success: true }> {
  if (typeof deviceId !== 'string' || !deviceId || typeof startPlaying !== 'boolean') {
    throw new SpotifyApiError('A deviceId and a boolean play value are required.', 400);
  }
  await spotifyFetch('/me/player', { method: 'PUT', body: { device_ids: [deviceId], play: startPlaying } });
  return { success: true };
}

export async function play(): Promise<{ success: true }> {
  return command('/me/player/play', 'PUT');
}

export async function pause(): Promise<{ success: true }> {
  return command('/me/player/pause', 'PUT');
}

export async function next(): Promise<{ success: true }> {
  return command('/me/player/next', 'POST');
}

export async function previous(): Promise<{ success: true }> {
  return command('/me/player/previous', 'POST');
}

export async function seek(positionMs: number): Promise<{ success: true }> {
  requireInteger(positionMs, 0, Number.MAX_SAFE_INTEGER, 'position_ms');
  return command(`/me/player/seek?position_ms=${positionMs}`, 'PUT');
}

/** `percent` is 0 to 100. */
export async function setVolume(percent: number): Promise<{ success: true }> {
  requireInteger(percent, 0, 100, 'volume_percent');
  return command(`/me/player/volume?volume_percent=${percent}`, 'PUT');
}
