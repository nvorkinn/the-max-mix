// Spotify Web API calls made straight from the browser (Spotify allows CORS for them). In demo mode every function
// answers from a simulated player instead and never touches the network.

import type { PlaybackState, SpotifyDevice, Track } from '../types';
import { discardAccessToken, getAccessToken, isSignedIn } from './auth';
import { createDemoPlayer, DEMO_ONLY_MESSAGE } from './demo';
import { fetchSpotify, parseJson, readJson, SpotifyApiError } from './http';
import { isDemoMode } from './settings';

export { SpotifyApiError } from './http';

const demo = createDemoPlayer();

const MESSAGES: Record<number, string> = {
  401: 'Spotify authorization failed. Sign in again in Settings.',
  403: 'Spotify denied this action. Check Premium, app access, and device restrictions.',
  404: 'No available Spotify device. Open Spotify on a speaker or phone, then select it here.',
  429: 'Spotify rate limit reached. Wait before trying again.'
};

/** Spotify's own explanation of a refused request, when it gave one ({"error": {"message": "..."}}). */
async function spotifyReason(response: Response): Promise<string> {
  try {
    const body = parseJson(await response.text()) as { error?: { message?: unknown } } | null;
    const message = body?.error?.message;
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

/** Runs a simulated call and turns what it throws into a rejected promise, like a failed network call. */
const settle = async <T>(run: () => T): Promise<T> => {
  const result = await Promise.resolve(run());
  return result;
};

/** Resolves to null when nothing is playing anywhere. */
export async function getPlaybackState(): Promise<PlaybackState | null> {
  return isDemoMode() ? demo.getPlaybackState() : ((await spotifyFetch('/me/player')) as PlaybackState | null);
}

export async function getQueue(): Promise<{ currently_playing: Track | null; queue: Track[] }> {
  if (isDemoMode()) return demo.getQueue();
  const data = (await spotifyFetch('/me/player/queue')) as {
    currently_playing?: Track | null;
    queue?: Track[];
  } | null;
  return { currently_playing: data?.currently_playing ?? null, queue: data?.queue ?? [] };
}

export async function getDevices(): Promise<{ devices: SpotifyDevice[] }> {
  if (isDemoMode()) return demo.getDevices();
  const data = (await spotifyFetch('/me/player/devices')) as { devices?: SpotifyDevice[] } | null;
  return { devices: data?.devices ?? [] };
}

export async function transferPlayback(deviceId: string, startPlaying = false): Promise<{ success: true }> {
  if (typeof deviceId !== 'string' || !deviceId || typeof startPlaying !== 'boolean') {
    throw new SpotifyApiError('A deviceId and a boolean play value are required.', 400);
  }
  await (isDemoMode()
    ? settle(() => demo.transferPlayback(deviceId, startPlaying))
    : spotifyFetch('/me/player', { method: 'PUT', body: { device_ids: [deviceId], play: startPlaying } }));
  return { success: true };
}

export async function play(): Promise<{ success: true }> {
  if (!isDemoMode()) return command('/me/player/play', 'PUT');
  demo.play();
  return { success: true };
}

export async function pause(): Promise<{ success: true }> {
  if (!isDemoMode()) return command('/me/player/pause', 'PUT');
  demo.pause();
  return { success: true };
}

export async function next(): Promise<{ success: true }> {
  if (!isDemoMode()) return command('/me/player/next', 'POST');
  demo.skip('next');
  return { success: true };
}

export async function previous(): Promise<{ success: true }> {
  if (!isDemoMode()) return command('/me/player/previous', 'POST');
  demo.skip('previous');
  return { success: true };
}

export async function seek(positionMs: number): Promise<{ success: true }> {
  requireInteger(positionMs, 0, Number.MAX_SAFE_INTEGER, 'position_ms');
  if (!isDemoMode()) return command(`/me/player/seek?position_ms=${positionMs}`, 'PUT');
  demo.seek(positionMs);
  return { success: true };
}

/** `percent` is 0 to 100. */
export async function setVolume(percent: number): Promise<{ success: true }> {
  requireInteger(percent, 0, 100, 'volume_percent');
  if (!isDemoMode()) return command(`/me/player/volume?volume_percent=${percent}`, 'PUT');
  demo.setVolume(percent);
  return { success: true };
}

/** Demo mode only: replaces the demo queue with the same tracks in a new order (others get a 409). */
export function reorderDemoQueue(queue: Track[]) {
  return isDemoMode() ? settle(() => demo.reorder(queue)) : Promise.reject(new SpotifyApiError(DEMO_ONLY_MESSAGE, 409));
}

/** Demo mode only: plays a queued demo track now (others get a 409). */
export function playDemoTrackNow(trackId: string) {
  return isDemoMode()
    ? settle(() => demo.playNow(trackId))
    : Promise.reject(new SpotifyApiError(DEMO_ONLY_MESSAGE, 409));
}
