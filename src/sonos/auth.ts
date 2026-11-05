// Sonos sign-in. Sonos needs the app's client secret for every token request, so the token requests go through the app's
// own server function (api/sonos.ts), which holds the secret. Like the Spotify login, the long-lived refresh token is kept
// in localStorage. Storage can be unavailable: every access tolerates that.

import { parseJson } from '../spotify/http';
import { recordOf } from '../spotify/parse';

const AUTH_KEY = 'maxmix.sonosAuth';
const STATE_KEY = 'maxmix.sonosState';
const ENDPOINT = '/api/sonos';
/** Where Sonos sends the browser back to. The server function builds the same address from its own origin. */
const SONOS_CALLBACK_PATH = '/sonos/callback';

type SignInResult = { ok: true } | { ok: false; error: string };

// An access token is renewed this long before it expires, so a request never starts with one about to lapse.
const EXPIRY_MARGIN_MS = 60_000;

let memoryRefreshToken: string | null = null;
let signInError: string | null = null;
let cachedAccess: { token: string; expiresAt: number } | null = null;
let refreshing: Promise<string | null> | null = null;
// Bumped by signOutSonos so that a refresh already under way cannot bring a forgotten login back.
let generation = 0;

function readRefreshToken(): string | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(AUTH_KEY);
  } catch {
    return memoryRefreshToken;
  }
  if (raw === null) return null;
  try {
    const { refreshToken } = recordOf(parseJson(raw));
    if (typeof refreshToken === 'string' && refreshToken) return refreshToken;
  } catch {
    // Unreadable: treated as signed out.
  }
  return null;
}

/** A null token forgets the login. */
function writeRefreshToken(refreshToken: string | null): void {
  memoryRefreshToken = refreshToken;
  try {
    if (refreshToken) localStorage.setItem(AUTH_KEY, JSON.stringify({ refreshToken }));
    else localStorage.removeItem(AUTH_KEY);
  } catch {
    // Storage is unavailable; the login then lasts only until the page reloads.
  }
}

const randomState = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('');

/** Starts sign-in: remembers a random state, then lets the server function send the browser on to Sonos. */
export function startSonosSignIn(): void {
  signInError = null;
  const state = randomState();
  try {
    sessionStorage.setItem(STATE_KEY, state);
  } catch {
    throw new Error('Browser storage is blocked, so Sonos sign-in cannot finish. Allow site data and try again.');
  }
  location.assign(`${ENDPOINT}?${new URLSearchParams({ state })}`);
}

function takeState(): string | null {
  try {
    const state = sessionStorage.getItem(STATE_KEY);
    // A state is good for one reply: remove it first, so a replayed reply cannot reuse it.
    sessionStorage.removeItem(STATE_KEY);
    return state;
  } catch {
    return null;
  }
}

/**
 * Asks the server function to swap the sign-in code for tokens and returns the refresh token; throws with a message for
 * the person when that fails. The access token that comes with it is not needed yet.
 */
async function requestRefreshToken(code: string): Promise<string> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  });
  let data: Record<string, unknown> = {};
  try {
    data = recordOf(await response.json());
  } catch {
    // Not JSON: handled below.
  }
  if (!response.ok) {
    // 401: the code was used already or has expired.
    if (response.status === 401) throw new Error('Sonos sign-in expired. Start again from Settings.');
    const error = data['error'];
    throw new Error(typeof error === 'string' ? error : `Sonos sign-in failed (${response.status}).`);
  }
  const { refreshToken } = data;
  if (typeof refreshToken !== 'string' || !refreshToken) {
    throw new Error('Sonos did not provide a refresh token. Sign in again.');
  }
  return refreshToken;
}

async function finishSignIn(query: URLSearchParams): Promise<SignInResult> {
  const state = takeState();
  const error = query.get('error');
  if (error) {
    return {
      ok: false,
      error: error === 'access_denied' ? 'Sonos sign-in was declined.' : `Sonos sign-in failed (${error}).`
    };
  }
  if (!state || state !== query.get('state')) {
    return { ok: false, error: 'Sonos sign-in expired or has an invalid state. Start again from Settings.' };
  }
  const code = query.get('code');
  if (!code) return { ok: false, error: 'Missing Sonos authorization code.' };
  try {
    writeRefreshToken(await requestRefreshToken(code));
    cachedAccess = null;
    return { ok: true };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : 'Sonos sign-in failed.' };
  }
}

/** True when the address is Sonos's sign-in reply (Spotify's sign-in then leaves its ?code= alone). */
export function isSonosCallback(): boolean {
  return location.pathname === SONOS_CALLBACK_PATH;
}

/**
 * Finishes sign-in when the address is Sonos's reply (/sonos/callback?code=&state=, or ?error=): checks the state,
 * exchanges the code for tokens and moves the address back to the app's start page. Does nothing on any other address.
 * A failure is kept for getSonosSignInError.
 */
export async function completeSonosSignIn(): Promise<void> {
  if (!isSonosCallback()) return;
  const query = new URLSearchParams(location.search);
  history.replaceState(history.state, '', `/${location.hash}`);
  const result = await finishSignIn(query);
  signInError = result.ok ? null : result.error;
}

/** Why the last Sonos sign-in failed, until the next one starts; null when it went through. */
export function getSonosSignInError(): string | null {
  return signInError;
}

/** True when a Sonos refresh token is stored (the login may still turn out to have been revoked). */
export function isSonosSignedIn(): boolean {
  return readRefreshToken() !== null;
}

/** Asks the server function for a new access token with the stored refresh token. */
async function refreshAccess(refreshToken: string): Promise<string | null> {
  const started = generation;
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken })
  });
  let data: Record<string, unknown> = {};
  try {
    data = recordOf(await response.json());
  } catch {
    // Not JSON: handled below.
  }
  // Signed out (or in again) while the server was answering: that result is stale.
  if (started !== generation) return null;
  if (response.status === 401) {
    // Sonos says the login was revoked: forget it, so Settings offers to sign in again.
    writeRefreshToken(null);
    return null;
  }
  const { accessToken, refreshToken: newRefreshToken, expiresIn } = data;
  if (typeof accessToken !== 'string' || typeof expiresIn !== 'number' || !response.ok) {
    const error = data['error'];
    throw new Error(typeof error === 'string' ? error : `Sonos could not be reached (${response.status}).`);
  }
  // Sonos may rotate the refresh token; keep the new one, else the old one stays valid.
  if (typeof newRefreshToken === 'string' && newRefreshToken) writeRefreshToken(newRefreshToken);
  cachedAccess = { token: accessToken, expiresAt: Date.now() + expiresIn * 1000 - EXPIRY_MARGIN_MS };
  return accessToken;
}

/**
 * A valid Sonos access token, refreshed when it is about to expire; concurrent callers share one refresh. Null when
 * signed out, including when Sonos says the login was revoked. Throws when the refresh fails for another reason.
 */
export async function getSonosAccessToken(): Promise<string | null> {
  const refreshToken = readRefreshToken();
  if (!refreshToken) return null;
  if (cachedAccess && Date.now() < cachedAccess.expiresAt) return cachedAccess.token;
  refreshing ??= refreshAccess(refreshToken).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** Drops the cached access token so the next getSonosAccessToken refreshes (used after Sonos answers 401). */
export function discardSonosAccessToken(): void {
  cachedAccess = null;
}

/** Forgets the Sonos login and the cached access token. */
export function signOutSonos(): void {
  generation += 1;
  cachedAccess = null;
  writeRefreshToken(null);
  try {
    sessionStorage.removeItem(STATE_KEY);
  } catch {
    // Storage is unavailable; there is nothing kept in it either.
  }
}
