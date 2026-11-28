// Spotify sign-in with PKCE (RFC 7636), on a phone: the kiosk keeps a random code verifier in memory and hands only its
// SHA-256 hash to countdown-server, which sends the phone that scanned the kiosk's code to Spotify and hands Spotify's
// code back (countdown/spotifySignIn.ts). The kiosk then exchanges the code itself, with its verifier. The long-lived
// refresh tokens are kept in localStorage: one per person who signed in on this kiosk, with their Spotify ID, name and
// picture, and which of them is active.

import { getClientId } from './settings';
import { fetchSpotify, parseJson, readJson, SpotifyApiError } from './http';
import { recordOf } from './parse';

const PEOPLE_KEY = 'maxmix.people';
// The single login kept before there were people; moved into the people list the first time it is read.
const LEGACY_AUTH_KEY = 'maxmix.auth';
// Who just signed in without a phone linked, until the app has offered to pair one (takePhoneToPair).
const PAIR_PHONE_KEY = 'maxmix.pairPhoneFor';
// Each person's remembered speakers (knownDevices.ts), dropped with the person.
const KNOWN_SPEAKERS_KEY = 'maxmix.knownSpeakers';
/** What the kiosk asks Spotify for when someone signs in. */
export const SCOPES =
  'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state user-read-currently-playing user-library-read user-read-recently-played playlist-read-private';
// An access token is renewed this long before it expires, so a request never starts with one about to lapse.
const EXPIRY_MARGIN_MS = 60_000;

interface StoredLogin {
  clientId: string;
  refreshToken: string;
}
/**
 * Someone signed in on this kiosk. The Spotify ID, name and picture are blank until GET /me has named the account. The
 * refresh token is blank once Spotify has said their login expired or was revoked: they stay listed, with their phone
 * and speakers, until they sign in again or are removed. The phone address is the Bluetooth address of their paired
 * phone (the Pi's saved phones), blank until one is linked.
 */
interface Person {
  spotifyId: string;
  name: string;
  imageUrl: string;
  refreshToken: string;
  phoneAddress: string;
}
/** Everyone signed in with one client ID, and the active person's Spotify ID (null for nobody). */
interface People {
  clientId: string;
  activeId: string | null;
  people: Person[];
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
export type SignInResult = { ok: true } | { ok: false; error: string };

/** The people as far as this page knows them; the only copy when storage is unavailable. */
let memoryPeople: People | null = null;
let cachedAccess: { token: string; clientId: string; expiresAt: number } | null = null;
/** Access tokens for people other than the active one, by Spotify ID (see getAccessTokenFor). */
const otherAccess = new Map<string, { token: string; expiresAt: number }>();
let refreshing: Promise<string | null> | null = null;
// Bumped by signOut so that a refresh already under way cannot bring a forgotten login back.
let generation = 0;

const base64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCodePoint(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');

const randomString = (length: number): string => base64Url(crypto.getRandomValues(new Uint8Array(length)));

/** The S256 challenge of a PKCE verifier: what whoever starts the sign-in is told in its place. */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

function parsePerson(value: unknown): Person | null {
  const { spotifyId, name, imageUrl, refreshToken, phoneAddress } = recordOf(value);
  // Someone with an expired login is kept only when they are named: an unnamed one could never be told apart.
  return typeof refreshToken === 'string' && (refreshToken || textOf(spotifyId))
    ? {
        spotifyId: textOf(spotifyId),
        name: textOf(name),
        imageUrl: textOf(imageUrl),
        refreshToken,
        phoneAddress: textOf(phoneAddress)
      }
    : null;
}

function parsePeople(raw: string): People | null {
  const { clientId, activeId, people } = recordOf(parseJson(raw));
  if (typeof clientId !== 'string' || !Array.isArray(people)) return null;
  return {
    clientId,
    activeId: typeof activeId === 'string' ? activeId : null,
    people: (people as unknown[]).map(person => parsePerson(person)).filter(person => person !== null)
  };
}

/** Today's people from the login kept before there were people: one person, not yet named, who is active. */
function parseLegacyLogin(raw: string): People | null {
  const { clientId, refreshToken } = recordOf(parseJson(raw));
  return typeof clientId === 'string' && typeof refreshToken === 'string' && refreshToken
    ? { clientId, activeId: '', people: [{ spotifyId: '', name: '', imageUrl: '', refreshToken, phoneAddress: '' }] }
    : null;
}

/** A null list forgets everyone. */
function writePeople(people: People | null): void {
  memoryPeople = people;
  try {
    if (people) localStorage.setItem(PEOPLE_KEY, JSON.stringify(people));
    else localStorage.removeItem(PEOPLE_KEY);
    localStorage.removeItem(LEGACY_AUTH_KEY);
  } catch {
    // Storage is unavailable; the people then last only until the page reloads.
  }
}

function readPeople(): People | null {
  let raw: string | null;
  let legacy: string | null = null;
  try {
    raw = localStorage.getItem(PEOPLE_KEY);
    if (raw === null) legacy = localStorage.getItem(LEGACY_AUTH_KEY);
  } catch {
    return memoryPeople;
  }
  try {
    if (raw !== null) return parsePeople(raw);
    const moved = legacy === null ? null : parseLegacyLogin(legacy);
    if (moved) writePeople(moved);
    return moved;
  } catch {
    // Unreadable: treated as signed out.
    return null;
  }
}

/** Changes the person with `spotifyId`. */
function updatePerson(spotifyId: string, change: (person: Person) => Person): void {
  const people = readPeople();
  if (!people) return;
  writePeople({
    ...people,
    people: people.people.map(person => (person.spotifyId === spotifyId ? change(person) : person))
  });
}

/**
 * Adds a person (or replaces the one with the same Spotify ID, keeping their place in the list). They become active
 * unless `keepActive` and someone else who is still signed in is active. Says whether they became active.
 */
function addPerson(clientId: string, person: Person, keepActive: boolean): boolean {
  const people = readPeople();
  const others = people?.clientId === clientId ? people.people : [];
  const active = others.find(other => other.spotifyId === people?.activeId);
  const becomesActive = !keepActive || !active?.refreshToken || active.spotifyId === person.spotifyId;
  const known = others.some(other => other.spotifyId === person.spotifyId);
  writePeople({
    clientId,
    activeId: becomesActive ? person.spotifyId : (people?.activeId ?? null),
    people: known ? others.map(other => (other.spotifyId === person.spotifyId ? person : other)) : [...others, person]
  });
  return becomesActive;
}

/** Marks the person with `spotifyId` as signed out (their login expired or was revoked), keeping everything else of theirs. */
function expirePerson(spotifyId: string): void {
  updatePerson(spotifyId, person => ({ ...person, refreshToken: '' }));
  otherAccess.delete(spotifyId);
}

/** The active person's login, unless the people belong to a different client ID than the one in use. */
function currentLogin(): (StoredLogin & { spotifyId: string }) | null {
  const people = readPeople();
  if (people?.clientId !== getClientId()) return null;
  const person = people.people.find(known => known.spotifyId === people.activeId);
  return person?.refreshToken
    ? { clientId: people.clientId, refreshToken: person.refreshToken, spotifyId: person.spotifyId }
    : null;
}

/**
 * The Spotify ID of the person whose music the kiosk plays now. Null when nobody is signed in, or when the active person
 * moved in from the old single login and Spotify has not yet said who they are (that happens on the first token refresh).
 */
export function getActivePersonId(): string | null {
  return currentLogin()?.spotifyId || null;
}

/**
 * Who the account behind `accessToken` is, from GET /me; blank when Spotify does not say. Null when Spotify refuses the
 * account (403): in development mode it answers only accounts listed under the app's users in the developer dashboard.
 */
async function readProfile(accessToken: string): Promise<Pick<Person, 'spotifyId' | 'name' | 'imageUrl'> | null> {
  try {
    const response = await fetchSpotify('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (response.status === 403) return null;
    const { id, display_name: displayName, images } = recordOf(response.ok ? await readJson(response) : null);
    const image = Array.isArray(images) ? recordOf(images[0]) : {};
    return { spotifyId: textOf(id), name: textOf(displayName) || textOf(id), imageUrl: textOf(image['url']) };
  } catch {
    return { spotifyId: '', name: '', imageUrl: '' };
  }
}

/** Names the active person when they moved in from the old single login (no Spotify ID yet), once a token works. */
async function nameActivePerson(accessToken: string): Promise<void> {
  const profile = await readProfile(accessToken);
  const people = readPeople();
  if (!people || !profile?.spotifyId) return;
  writePeople({
    ...people,
    activeId: profile.spotifyId,
    people: people.people
      .filter(person => person.spotifyId !== profile.spotifyId)
      .map(person => (person.spotifyId === '' ? { ...person, ...profile } : person))
  });
}

/**
 * Asks Spotify's token endpoint for tokens (no client secret with PKCE). When a refresh for `spotifyId` is refused as
 * revoked, that person is marked signed out (see expirePerson).
 */
async function requestTokens(
  parameters: Record<string, string>,
  spotifyId?: string
): Promise<{ accessToken: string; refreshToken: string | undefined; expiresInMs: number }> {
  const response = await fetchSpotify('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: getClientId(), ...parameters })
  });
  if (!response.ok) {
    if (response.status === 400 && parameters['grant_type'] === 'refresh_token') {
      const data = parseTokenResponse(await readJson(response));
      if (spotifyId !== undefined && data.error === 'invalid_grant') {
        expirePerson(spotifyId);
        if (spotifyId === readPeople()?.activeId) cachedAccess = null;
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

/** A fresh PKCE verifier, which stays on the kiosk, and its S256 challenge, which goes to the phone. */
export async function newVerifier(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomString(64);
  return { verifier, challenge: await challengeFor(verifier) };
}

const failure = (error: string) => ({ ok: false as const, error });

/** Spotify lets an app in development mode sign in this many accounts at most. */
export const PEOPLE_LIMIT = 5;
const FULL = 'Spotify allows five people on this kiosk. Remove someone first.';
const NOT_LISTED =
  "Spotify refused this account. Add it under User Management in the Spotify app's dashboard, then sign in again.";
const OTHER_ACCOUNT = 'That was a different Spotify account, so nothing changed.';

/** Whether adding `spotifyId` with `clientId` would go past PEOPLE_LIMIT (someone already listed can always sign in again). */
function isFull(clientId: string, spotifyId: string): boolean {
  const people = readPeople();
  return (
    people?.clientId === clientId &&
    people.people.length >= PEOPLE_LIMIT &&
    people.people.every(person => person.spotifyId !== spotifyId)
  );
}

/** What a phone sign-in came back with: Spotify's code, or its error, and where Spotify sent the phone. */
export interface PhoneReply {
  code?: string | undefined;
  error?: string | undefined;
  redirectUri: string;
}

/**
 * Finishes a sign-in on a phone: exchanges Spotify's code for tokens with the kiosk's own `verifier` and keeps them as
 * a person, who becomes active. With `as`, it was signing that person in again: any other account is refused, and
 * whoever is active stays so.
 */
export async function finishSignIn(reply: PhoneReply, verifier: string, as = ''): Promise<SignInResult> {
  const { code, error, redirectUri } = reply;
  if (error) {
    return failure(error === 'access_denied' ? 'Spotify sign-in was declined.' : `Spotify sign-in failed (${error}).`);
  }
  if (!code) return failure('Missing Spotify authorization code.');
  try {
    const clientId = getClientId();
    const tokens = await requestTokens({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier
    });
    if (!tokens.refreshToken) return failure('Spotify did not provide a refresh token. Sign in again.');
    const profile = await readProfile(tokens.accessToken);
    if (!profile) return failure(NOT_LISTED);
    if (as && profile.spotifyId !== as) return failure(OTHER_ACCOUNT);
    if (isFull(clientId, profile.spotifyId)) return failure(FULL);
    generation += 1;
    const known = readPeople()?.people.find(person => profile.spotifyId && person.spotifyId === profile.spotifyId);
    const active = addPerson(
      clientId,
      { ...profile, refreshToken: tokens.refreshToken, phoneAddress: known?.phoneAddress ?? '' },
      Boolean(as)
    );
    if (!known?.phoneAddress && profile.spotifyId) {
      try {
        sessionStorage.setItem(PAIR_PHONE_KEY, profile.spotifyId);
      } catch {
        // Storage is unavailable; they can still pair from Settings.
      }
    }
    const access = { token: tokens.accessToken, expiresAt: Date.now() + tokens.expiresInMs - EXPIRY_MARGIN_MS };
    if (active) cachedAccess = { ...access, clientId };
    else otherAccess.set(profile.spotifyId, access);
    return { ok: true as const };
  } catch (cause) {
    return failure(cause instanceof Error ? cause.message : 'Spotify sign-in failed.');
  }
}

/**
 * The Spotify ID of someone who has just signed in (or been added) with no phone linked, once: the app then offers to
 * pair their phone. Null when there is nobody to offer it to.
 */
export function takePhoneToPair(): string | null {
  try {
    const spotifyId = sessionStorage.getItem(PAIR_PHONE_KEY);
    sessionStorage.removeItem(PAIR_PHONE_KEY);
    return spotifyId || null;
  } catch {
    return null;
  }
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
    const tokens = await requestTokens(
      { grant_type: 'refresh_token', refresh_token: login.refreshToken },
      login.spotifyId
    );
    // Signed out (or in again) while Spotify was answering: that result is stale.
    if (started !== generation) return null;
    // Spotify may rotate the refresh token; keep the new one, else the old one stays valid.
    updatePerson(login.spotifyId, person => ({ ...person, refreshToken: tokens.refreshToken ?? login.refreshToken }));
    // Naming waits for nothing: a slow GET /me must not hold up the token.
    if (login.spotifyId === '') void nameActivePerson(tokens.accessToken);
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

/**
 * A valid access token for the person with `spotifyId`, who need not be the active one: the switcher uses it to see
 * what plays on their account. Null when no such person is signed in here. Throws a SpotifyApiError when Spotify
 * refuses (a revoked login is then marked signed out, as the active person's is).
 */
export async function getAccessTokenFor(spotifyId: string): Promise<string | null> {
  const people = readPeople();
  if (people?.clientId !== getClientId()) return null;
  if (spotifyId === people.activeId) return getAccessToken();
  const person = people.people.find(known => known.spotifyId === spotifyId);
  if (!person?.spotifyId || !person.refreshToken) return null;
  const cached = otherAccess.get(spotifyId);
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  const tokens = await requestTokens({ grant_type: 'refresh_token', refresh_token: person.refreshToken }, spotifyId);
  updatePerson(spotifyId, known => ({ ...known, refreshToken: tokens.refreshToken ?? known.refreshToken }));
  otherAccess.set(spotifyId, {
    token: tokens.accessToken,
    expiresAt: Date.now() + tokens.expiresInMs - EXPIRY_MARGIN_MS
  });
  return tokens.accessToken;
}

/** Makes the person with `spotifyId` active; the page then reloads so everything starts again as them. */
export function switchPerson(spotifyId: string): void {
  const people = readPeople();
  if (!people?.people.some(person => person.spotifyId === spotifyId)) return;
  generation += 1;
  cachedAccess = null;
  writePeople({ ...people, activeId: spotifyId });
}

/** Links the person with `spotifyId` to the paired phone at `address` ('' unlinks), so the switcher offers them only when the Pi hears it. */
export function linkPhone(spotifyId: string, address: string): void {
  updatePerson(spotifyId, person => ({ ...person, phoneAddress: address }));
}

/** Drops the cached access token so the next getAccessToken refreshes (used after Spotify answers 401). */
export function discardAccessToken(): void {
  cachedAccess = null;
}

/** Forgets everyone signed in on this kiosk and everything cached for them. */
export function signOut(): void {
  generation += 1;
  cachedAccess = null;
  otherAccess.clear();
  writePeople(null);
}

/** Someone signed in on this kiosk, as Settings shows them; the refresh token stays in here. */
export interface PersonOnKiosk {
  spotifyId: string;
  name: string;
  imageUrl: string;
  /** Their paired phone's Bluetooth address, or '' when none is linked. */
  phoneAddress: string;
  active: boolean;
  /** False once Spotify has said their login expired or was revoked. */
  signedIn: boolean;
}

/** Everyone signed in with the client ID in use, in the order they were added. */
export function peopleOnKiosk(): PersonOnKiosk[] {
  const people = readPeople();
  if (people?.clientId !== getClientId()) return [];
  return people.people.map(({ spotifyId, name, imageUrl, phoneAddress, refreshToken }) => ({
    spotifyId,
    name,
    imageUrl,
    phoneAddress,
    active: spotifyId === people.activeId,
    signedIn: refreshToken !== ''
  }));
}

/**
 * Where someone's Spotify login stands: 'connected', 'expired' (Spotify says it expired or was revoked: sign in
 * again), 'refused' (Spotify refuses the account, as it does in development mode for accounts missing from the app's
 * User Management) or 'unknown' (Spotify could not be asked).
 */
export type PersonStatus = 'connected' | 'expired' | 'refused' | 'unknown';

/** Asks Spotify where the login of the person with `spotifyId` stands: refreshes their token, then reads GET /me. */
export async function checkPerson(spotifyId: string): Promise<PersonStatus> {
  const isExpired = () => peopleOnKiosk().some(person => person.spotifyId === spotifyId && !person.signedIn);
  let token: string | null;
  try {
    token = await getAccessTokenFor(spotifyId);
  } catch {
    return isExpired() ? 'expired' : 'unknown';
  }
  if (!token) return isExpired() ? 'expired' : 'unknown';
  try {
    const response = await fetchSpotify('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (response.status === 403) return 'refused';
    return response.ok ? 'connected' : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Drops the person's own list in maxmix.knownSpeakers (an object keyed by Spotify ID; see knownDevices.ts). */
function forgetSpeakersOf(spotifyId: string): void {
  if (!spotifyId) return;
  try {
    const stored: unknown = parseJson(localStorage.getItem(KNOWN_SPEAKERS_KEY) ?? 'null');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored) || !Object.hasOwn(stored, spotifyId)) return;
    const others = Object.fromEntries(Object.entries(stored).filter(([id]) => id !== spotifyId));
    localStorage.setItem(KNOWN_SPEAKERS_KEY, JSON.stringify(others));
  } catch {
    // Unavailable or unreadable: nothing of theirs can be dropped.
  }
}

/**
 * Forgets one person. Says what follows: 'kept' when someone else was active, 'switched' when they were the active
 * person and the next person on the list is now active (reload to play as them), 'signed-out' when they were the last
 * (as signOut, so reload).
 */
export function removePerson(spotifyId: string): 'kept' | 'switched' | 'signed-out' {
  const people = readPeople();
  if (!people) return 'kept';
  forgetSpeakersOf(spotifyId);
  const remaining = people.people.filter(person => person.spotifyId !== spotifyId);
  const [next] = remaining;
  if (!next) {
    signOut();
    return 'signed-out';
  }
  if (people.activeId !== spotifyId) {
    writePeople({ ...people, people: remaining });
    return 'kept';
  }
  generation += 1;
  cachedAccess = null;
  writePeople({ ...people, activeId: next.spotifyId, people: remaining });
  return 'switched';
}
