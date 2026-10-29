// Pieces shared by auth and api: the error type and a fetch that gives up after 15 seconds.

/** Error with the HTTP status of the failing Spotify call; `retryAfter` is in seconds (0 when none was given). */
export class SpotifyApiError extends Error {
  status: number;
  retryAfter: number;

  constructor(message: string, status = 502, retryAfter = 0) {
    super(message);
    this.name = 'SpotifyApiError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/** JSON.parse and Response.json return any; parsed data is untrusted until checked, so it is typed unknown. */
export const parseJson = (text: string): unknown => JSON.parse(text);

/** The JSON body of a reply, or null when there is none or it is not JSON. */
export const readJson = (response: Response): Promise<unknown> => response.json().catch(() => null);

/** fetch with a 15 second timeout. Network failures and timeouts become a SpotifyApiError with a readable message. */
export async function fetchSpotify(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'TimeoutError') {
      throw new SpotifyApiError('Spotify did not answer in time. Try again.', 504);
    }
    throw new SpotifyApiError('Could not reach Spotify. Check the network connection.', 502);
  }
}
