// Spotify sign-in with PKCE, entirely in the browser (RFC 7636): a random code verifier stays in sessionStorage while
// Spotify's page is open, and only its SHA-256 hash is sent. The long-lived refresh token is kept in localStorage.

import { getClientId, getRedirectUri } from './settings';
import { fetchSpotify, parseJson, readJson, SpotifyApiError } from './http';
import { recordOf } from './parse';

const AUTH_KEY = 'maxmix.auth';
const PKCE_KEY = 'maxmix.pkce';
const SCOPES =
  'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state user-read-currently-playing';
// An access token is renewed this long before it expires, so a request never starts with one about to lapse.
const EXPIRY_MARGIN_MS = 60_000;
const REPLY_PARAMETERS = ['code', 'state', 'error', 'error_description'];

interface StoredLogin {
  clientId: string;
  refreshToken: string;
}
interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
}
/** Picks the token fields out of a token endpoint reply; anything of the wrong type counts as missing. */
function parseTokenResponse(value: unknown): TokenResponse {
  const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn, error } = recordOf(value);
  return {
    ...(typeof accessToken === 'string' && { access_token: accessToken }),
    ...(typeof refreshToken === 'string' && { refresh_token: refreshToken }),
    ...(typeof expiresIn === 'number' && { expires_in: expiresIn }),
    ...(typeof error === 'string' && { error })
  };
}
type SignInResult = { ok: true } | { ok: false; error: string };

/** The login as far as this page knows it; the only copy when storage is unavailable. */
let memoryLogin: StoredLogin | null = null;
let cachedAccess: { token: string; clientId: string; expiresAt: number } | null = null;
let refreshing: Promise<string | null> | null = null;
let completing: Promise<SignInResult | null> | null = null;
// Bumped by signOut so that a refresh already under way cannot bring a forgotten login back.
let generation = 0;

const base64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCodePoint(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');

const randomString = (length: number): string => base64Url(crypto.getRandomValues(new Uint8Array(length)));

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function readLogin(): StoredLogin | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(AUTH_KEY);
  } catch {
    return memoryLogin;
  }
  if (raw === null) return null;
  try {
    const { clientId, refreshToken } = recordOf(parseJson(raw));
    if (typeof clientId === 'string' && typeof refreshToken === 'string' && refreshToken) {
      return { clientId, refreshToken };
    }
  } catch {
    // Unreadable: treated as signed out.
  }
  return null;
}

/** A null login forgets the login. */
function writeLogin(login: StoredLogin | null): void {
  memoryLogin = login;
  try {
    if (login) localStorage.setItem(AUTH_KEY, JSON.stringify(login));
    else localStorage.removeItem(AUTH_KEY);
  } catch {
    // Storage is unavailable; the login then lasts only until the page reloads.
  }
}

/** The stored login, unless it belongs to a different client ID than the one in use. */
function currentLogin(): StoredLogin | null {
  const login = readLogin();
  return login?.clientId === getClientId() ? login : null;
}

/** Asks Spotify's token endpoint for tokens (no client secret with PKCE). */
async function requestTokens(
  parameters: Record<string, string>
): Promise<{ accessToken: string; refreshToken: string | undefined; expiresInMs: number }> {
  const response = await fetchSpotify('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: getClientId(), ...parameters })
  });
  if (!response.ok) {
    if (response.status === 400 && parameters['grant_type'] === 'refresh_token') {
      const data = parseTokenResponse(await readJson(response));
      if (data.error === 'invalid_grant') {
        writeLogin(null);
        cachedAccess = null;
        throw new SpotifyApiError('Spotify login expired or was revoked. Sign in again in Settings.', 401);
      }
    }
    throw new SpotifyApiError(
      `Spotify authentication failed (${response.status}). Check the client ID and the redirect address, then sign in again.`,
      502
    );
  }
  const data = parseTokenResponse(await readJson(response));
  if (!data.access_token || typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in)) {
    throw new SpotifyApiError('Spotify returned an invalid token response.');
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || undefined,
    expiresInMs: data.expires_in * 1000
  };
}

/** Starts sign-in: stores a PKCE verifier and state, then navigates to Spotify. */
export async function startSignIn(): Promise<void> {
  const clientId = getClientId();
  const verifier = randomString(64);
  const state = randomString(32);
  const challenge = await challengeFor(verifier);
  try {
    sessionStorage.setItem(PKCE_KEY, JSON.stringify({ state, verifier }));
  } catch {
    throw new Error('Browser storage is blocked, so Spotify sign-in cannot finish. Allow site data and try again.');
  }
  const parameters = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    state,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SCOPES
  });
  location.assign(`https://accounts.spotify.com/authorize?${parameters}`);
}

function takePkce(): { state: string; verifier: string } | null {
  try {
    const raw = sessionStorage.getItem(PKCE_KEY);
    // A verifier is good for one exchange: remove it before using it, so a replayed reply cannot reuse it.
    sessionStorage.removeItem(PKCE_KEY);
    if (raw === null) return null;
    const { state, verifier } = recordOf(parseJson(raw));
    if (typeof state === 'string' && typeof verifier === 'string' && verifier) return { state, verifier };
  } catch {
    // Unavailable or unreadable: treated as missing.
  }
  return null;
}

const failure = (error: string) => ({ ok: false as const, error });

async function finishSignIn(query: URLSearchParams): Promise<SignInResult> {
  const pkce = takePkce();
  const error = query.get('error');
  if (error) {
    return failure(error === 'access_denied' ? 'Spotify sign-in was declined.' : `Spotify sign-in failed (${error}).`);
  }
  if (!pkce?.verifier || pkce.state !== query.get('state')) {
    return failure('Spotify sign-in expired or has an invalid state. Start again from Settings.');
  }
  const code = query.get('code');
  if (!code) return failure('Missing Spotify authorization code.');
  try {
    const clientId = getClientId();
    const tokens = await requestTokens({
      grant_type: 'authorization_code',
      code,
      redirect_uri: getRedirectUri(),
      code_verifier: pkce.verifier
    });
    if (!tokens.refreshToken) return failure('Spotify did not provide a refresh token. Sign in again.');
    generation += 1;
    writeLogin({ clientId, refreshToken: tokens.refreshToken });
    cachedAccess = {
      token: tokens.accessToken,
      clientId,
      expiresAt: Date.now() + tokens.expiresInMs - EXPIRY_MARGIN_MS
    };
    return { ok: true as const };
  } catch (cause) {
    return failure(cause instanceof Error ? cause.message : 'Spotify sign-in failed.');
  }
}

/**
 * Finishes sign-in when the address carries Spotify's ?code=&state= (or ?error=) reply: checks the state, exchanges
 * the code for tokens, stores them and removes the query from the address. Call once at startup (a second call while
 * the first is still running shares its result). Resolves to null when the address is not a sign-in reply.
 */
export function completeSignIn(): Promise<SignInResult | null> {
  if (completing) return completing;
  const query = new URLSearchParams(location.search);
  if (!query.has('code') && !query.has('error')) return Promise.resolve(null);
  const remaining = new URLSearchParams(location.search);
  for (const name of REPLY_PARAMETERS) remaining.delete(name);
  const search = remaining.size > 0 ? `?${remaining}` : '';
  history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`);
  const attempt = finishSignIn(query).finally(() => {
    completing = null;
  });
  completing = attempt;
  return attempt;
}

/** True when a refresh token is stored (the login may still turn out to have been revoked). */
export function isSignedIn(): boolean {
  return currentLogin() !== null;
}

/**
 * A valid access token, refreshed when it is about to expire; concurrent callers share one refresh. Null when signed
 * out, including when Spotify says the login was revoked (the stored login is then removed). Throws a SpotifyApiError
 * when Spotify cannot be reached or refuses the refresh for another reason.
 */
export async function getAccessToken(): Promise<string | null> {
  const login = currentLogin();
  if (!login) return null;
  if (cachedAccess?.clientId === login.clientId && Date.now() < cachedAccess.expiresAt) {
    return cachedAccess.token;
  }
  refreshing ??= (async () => {
    const started = generation;
    const tokens = await requestTokens({ grant_type: 'refresh_token', refresh_token: login.refreshToken });
    // Signed out (or in again) while Spotify was answering: that result is stale.
    if (started !== generation) return null;
    // Spotify may rotate the refresh token; keep the new one, else the old one stays valid.
    writeLogin({ clientId: login.clientId, refreshToken: tokens.refreshToken ?? login.refreshToken });
    cachedAccess = {
      token: tokens.accessToken,
      clientId: login.clientId,
      expiresAt: Date.now() + tokens.expiresInMs - EXPIRY_MARGIN_MS
    };
    return tokens.accessToken;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** Drops the cached access token so the next getAccessToken refreshes (used after Spotify answers 401). */
export function discardAccessToken(): void {
  cachedAccess = null;
}

/** Forgets the stored login. */
export function signOut(): void {
  generation += 1;
  cachedAccess = null;
  writeLogin(null);
}
