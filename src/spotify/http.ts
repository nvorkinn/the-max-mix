// Shared HTTP errors and timeouts; a known Web API cooldown does not block the separate OAuth token endpoint.

/** Error with the HTTP status of the failing Spotify call; `retryAfter` is in seconds (0 when none was given). */
export class SpotifyApiError extends Error {
  status: number;
  retryAfter: number;
  retryAt: number;

  constructor(message: string, status = 502, retryAfter = 0, retryAt = Date.now() + retryAfter * 1000) {
    super(message);
    this.name = 'SpotifyApiError';
    this.status = status;
    this.retryAfter = retryAfter;
    this.retryAt = retryAt;
  }
}

const MAX_TIMER_DELAY = 2_147_483_647;
let spotifyRetryAt = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
const retryListeners = new Set<() => void>();

export const getSpotifyRetryAt = () => spotifyRetryAt;

export function subscribeSpotifyRetryAt(listener: () => void): () => void {
  retryListeners.add(listener);
  return () => {
    retryListeners.delete(listener);
  };
}

export const getSpotifyRetryDelay = () => Math.min(MAX_TIMER_DELAY, Math.max(0, spotifyRetryAt - Date.now()));

function expireRetryWindow() {
  const delay = getSpotifyRetryDelay();
  if (delay > 0) {
    retryTimer = setTimeout(expireRetryWindow, delay);
    return;
  }
  setRetryAt(0);
}

function setRetryAt(at: number) {
  if (at === spotifyRetryAt) return;
  clearTimeout(retryTimer);
  spotifyRetryAt = at;
  retryTimer = at > 0 ? setTimeout(expireRetryWindow, getSpotifyRetryDelay()) : undefined;
  for (const listener of retryListeners) listener();
}

/** Preserve absolute provider deadlines, so blocked retries cannot extend the wait through rounding. */
export function recordSpotifyRetryAfter(error: SpotifyApiError): void {
  if (error.retryAfter > 0 && Number.isSafeInteger(error.retryAt) && error.retryAt > Date.now()) {
    setRetryAt(Math.max(spotifyRetryAt, error.retryAt));
  }
}

export function checkSpotifyRetryWindow(): void {
  const remaining = spotifyRetryAt - Date.now();
  if (remaining > 0) {
    throw new SpotifyApiError(
      'Spotify asked this app to wait before retrying.',
      429,
      Math.ceil(remaining / 1000),
      spotifyRetryAt
    );
  }
  if (spotifyRetryAt !== 0) setRetryAt(0);
}

/** Retry-After accepts seconds or an HTTP date; absent, invalid and expired values impose no known deadline. */
function responseRetryAt(response: Response): number {
  const raw = response.headers.get('retry-after');
  if (!raw?.trim()) return 0;
  const seconds = Number(raw);
  const at = Number.isFinite(seconds) ? Date.now() + Math.ceil(seconds) * 1000 : Date.parse(raw);
  return Number.isSafeInteger(at) && at > Date.now() ? at : 0;
}

export const spotifyRetryAfter = (response: Response): number =>
  Math.ceil(Math.max(0, responseRetryAt(response) - Date.now()) / 1000);

/** Shown when fetch itself fails, which is how a lost internet connection looks. */
export const NETWORK_ERROR_MESSAGE = 'Could not reach Spotify. Check the network connection.';

/** JSON.parse and Response.json return any; parsed data is untrusted until checked, so it is typed unknown. */
export const parseJson = (text: string): unknown => JSON.parse(text);

/** The JSON body of a reply, or null when there is none or it is not JSON. */
export const readJson = (response: Response): Promise<unknown> => response.json().catch(() => null);

/** fetch with a 15 second timeout. Network failures and timeouts become a SpotifyApiError with a readable message. */
export async function fetchSpotify(url: string, init: RequestInit): Promise<Response> {
  const webApi = url.startsWith('https://api.spotify.com/');
  if (webApi) checkSpotifyRetryWindow();
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'TimeoutError') {
      throw new SpotifyApiError('Spotify did not answer in time. Try again.', 504);
    }
    throw new SpotifyApiError(NETWORK_ERROR_MESSAGE, 502);
  }
  if (webApi && !response.ok) {
    const retryAt = responseRetryAt(response);
    if (retryAt > 0) {
      const error = new SpotifyApiError(
        'Spotify asked this app to wait before retrying.',
        response.status,
        Math.ceil((retryAt - Date.now()) / 1000),
        retryAt
      );
      recordSpotifyRetryAfter(error);
    }
  }
  return response;
}
