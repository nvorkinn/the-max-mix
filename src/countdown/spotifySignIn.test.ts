import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json';
import { phoneSignInReply, startPhoneSignIn } from './spotifySignIn';
import type { PhoneSignIn } from './spotifySignIn';

const SECRET = fixture.registration.secret;
const CLIENT = { baseUrl: 'https://api.countdown.build', secret: SECRET };
const SITE = 'https://app.countdown.build';
const STARTED = fixture.spotify_sign_in;

function answer(status: number, body?: unknown) {
  const fetch = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
      })
    )
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

/** The request a fetch was called with, whole but for its signal (jsdom's, which Node's Request doesn't take). */
function requestOf(fetch: ReturnType<typeof answer>): Request {
  const [input, init] = fetch.mock.calls[0] ?? [''];
  return new Request(input, { ...init, signal: null });
}

const signal = () => new AbortController().signal;

const signIn: PhoneSignIn = {
  id: STARTED.id,
  pageUrl: `${SITE}/spotify/sign-in?id=${STARTED.id}`,
  redirectUri: STARTED.redirect_uri,
  verifier: 'the-verifier',
  expiresAt: 0
};

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-24T12:00:00Z') });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('startPhoneSignIn', () => {
  it('sends the challenge of a verifier it keeps, and shows the settings site’s page for the sign-in', async () => {
    const fetch = answer(201, STARTED);

    const started = await startPhoneSignIn(CLIENT, SITE, signal());

    const request = requestOf(fetch);
    expect(request.url).toBe('https://api.countdown.build/api/devices/spotify/sign-ins');
    expect(request.method).toBe('POST');
    expect(request.headers.get('Authorization')).toBe(`Bearer ${SECRET}`);
    const body = (await request.json()) as Record<string, string>;
    expect(Object.keys(body).sort()).toEqual(['client_id', 'code_challenge', 'scope']);
    expect(body['scope']).toContain('user-modify-playback-state');
    expect(started).toEqual({
      id: STARTED.id,
      pageUrl: `${SITE}/spotify/sign-in?id=${STARTED.id}`,
      redirectUri: STARTED.redirect_uri,
      verifier: expect.stringMatching(/^[\w-]{43,128}$/) as unknown,
      expiresAt: Date.now() + STARTED.expires_in * 1000
    });
    // Only the challenge left the kiosk.
    expect(JSON.stringify(body)).not.toContain(started?.verifier);
  });

  it('is null when the server refuses or can’t be reached', async () => {
    answer(409, { error: 'only a touchscreen signs in to Spotify' });
    await expect(startPhoneSignIn(CLIENT, SITE, signal())).resolves.toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    );
    await expect(startPhoneSignIn(CLIENT, SITE, signal())).resolves.toBeNull();
  });
});

describe('phoneSignInReply', () => {
  it('asks for the sign-in with the device secret, and says it is waiting', async () => {
    const fetch = answer(200, fixture.spotify_sign_in_waiting);
    await expect(phoneSignInReply(CLIENT, signIn, signal())).resolves.toBe('waiting');
    const request = requestOf(fetch);
    expect(request.url).toBe(`https://api.countdown.build/api/devices/spotify/sign-ins/${STARTED.id}`);
    expect(request.headers.get('Authorization')).toBe(`Bearer ${SECRET}`);
  });

  it('hands on Spotify’s code with the address the phone came back to', async () => {
    answer(200, fixture.spotify_sign_in_done);
    await expect(phoneSignInReply(CLIENT, signIn, signal())).resolves.toEqual({
      code: fixture.spotify_sign_in_done.code,
      error: undefined,
      redirectUri: STARTED.redirect_uri
    });
  });

  it('hands on Spotify’s error', async () => {
    answer(200, { status: 'failed', error: 'access_denied' });
    await expect(phoneSignInReply(CLIENT, signIn, signal())).resolves.toMatchObject({ error: 'access_denied' });
  });

  it('says a sign-in the server no longer has is gone, and one it can’t ask about is unknown', async () => {
    answer(404, { error: 'no such sign-in' });
    await expect(phoneSignInReply(CLIENT, signIn, signal())).resolves.toBe('gone');
    answer(502);
    await expect(phoneSignInReply(CLIENT, signIn, signal())).resolves.toBeNull();
  });
});
