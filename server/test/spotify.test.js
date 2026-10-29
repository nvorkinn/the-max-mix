import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { SpotifyError, SpotifyService } from '../src/spotify.js';

/** @typedef {Omit<RequestInit, 'body' | 'headers'> & { body: URLSearchParams, headers: Record<string, string> }} TokenRequestInit */

/**
 * @param {import('node:test').TestContext} t
 * @param {(url: string, init: TokenRequestInit) => Promise<Response>} fetchImpl
 */
async function setup(t, fetchImpl) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'max-mix-auth-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const options = {
    dataDir,
    clientId: 'test-client',
    redirectUri: 'http://127.0.0.1:3000/api/auth/callback',
    fetchImpl: /** @type {typeof fetch} */ (/** @type {unknown} */ (fetchImpl))
  };
  const service = new SpotifyService(options);
  await service.initialize();
  return { service, options };
}
/**
 * @param {unknown} body
 * @param {number} [status]
 * @param {Record<string, string>} [headers]
 */
const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers });

/** @param {SpotifyService} service */
async function readStored(service) {
  /** @type {unknown} */
  const stored = JSON.parse(await readFile(service.tokenFile, 'utf8'));
  return /** @type {{ clientId: string, refreshToken: string }} */ (stored);
}

/**
 * Starts a sign-in and finishes it with the given code, the way the login and callback routes do.
 * @param {SpotifyService} service
 * @param {string} [code]
 */
async function signIn(service, code = 'code') {
  const state = randomUUID();
  service.getAuthUrl(state);
  return service.handleAuthCallback(code, state);
}

test('OAuth persists only the refresh token with owner-only permissions and restores after restart', async t => {
  /** @type {{ url: string, init: TokenRequestInit }[]} */
  const calls = [];
  const { service, options } = await setup(t, async (url, init) => {
    calls.push({ url, init });
    return json({ access_token: `access-${calls.length}`, refresh_token: `refresh-${calls.length}`, expires_in: 3600 });
  });
  assert.equal(await signIn(service, 'authorization-code'), 'access-1');
  const stored = await readStored(service);
  assert.deepEqual(stored, { clientId: 'test-client', refreshToken: 'refresh-1' });
  assert.equal((await stat(service.tokenFile)).mode & 0o777, 0o600);
  const restarted = new SpotifyService(options);
  await restarted.initialize();
  assert.ok(restarted.isAuthenticated());
  const tokens = await Promise.all([restarted.getValidAccessToken(), restarted.getValidAccessToken()]);
  assert.deepEqual(tokens, ['access-2', 'access-2']);
  assert.equal(calls.length, 2, 'Concurrent callers share a single refresh');
  assert.equal(calls[1]?.init.body.get('refresh_token'), 'refresh-1');
  assert.equal((await readStored(service)).refreshToken, 'refresh-2');
});

test('corrupt login data does not silently become demo mode', async t => {
  const { service, options } = await setup(t, async () => {
    throw new Error('Unexpected request');
  });
  await writeFile(service.tokenFile, '{bad json');
  await assert.rejects(new SpotifyService(options).initialize(), SyntaxError);
});

test('revoked refresh tokens are removed and require a new login', async t => {
  let revoked = false;
  const { service } = await setup(t, async () =>
    revoked
      ? json({ error: 'invalid_grant' }, 400)
      : json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 })
  );
  await signIn(service);
  service.tokenExpiresAt = 0;
  revoked = true;
  await assert.rejects(service.getValidAccessToken(), { status: 401 });
  assert.equal(service.isAuthenticated(), false);
  await assert.rejects(readFile(service.tokenFile), { code: 'ENOENT' });
});

test('a non-JSON 400 from the token endpoint is a SpotifyError and keeps the saved login', async t => {
  let broken = false;
  const { service } = await setup(t, async () =>
    broken
      ? new Response('<html>Bad Request</html>', { status: 400 })
      : json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 })
  );
  await signIn(service);
  service.tokenExpiresAt = 0;
  broken = true;
  await assert.rejects(service.getValidAccessToken(), error => error instanceof SpotifyError && error.status === 502);
  assert.ok(service.isAuthenticated());
  assert.equal((await readStored(service)).refreshToken, 'refresh');
});

test('real API requests use bearer auth, refresh once on 401, and preserve 204 responses', async t => {
  let playerCalls = 0;
  const { service } = await setup(t, async (url, init) => {
    if (url.endsWith('/api/token')) return json({ access_token: 'valid', refresh_token: 'refresh', expires_in: 3600 });
    assert.equal(init.headers['Authorization'], 'Bearer valid');
    playerCalls++;
    return playerCalls === 1 ? json({}, 401) : new Response(null, { status: 204 });
  });
  await signIn(service);
  assert.equal(await service.pause(), null);
  assert.equal(playerCalls, 2);
});

test('Spotify errors and Retry-After propagate instead of returning mock success', async t => {
  let status = 429;
  const { service } = await setup(t, async url =>
    url.endsWith('/api/token')
      ? json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 })
      : json({}, status, { 'Retry-After': '30' })
  );
  await signIn(service);
  await assert.rejects(service.next(), { status: 429, retryAfter: '30' });
  status = 403;
  await assert.rejects(service.next(), { status: 403, message: /Premium/ });
});

test('sign-in uses PKCE: the challenge is the hash of a verifier that only the token exchange reveals', async t => {
  /** @type {{ url: string, init: TokenRequestInit }[]} */
  const calls = [];
  const { service } = await setup(t, async (url, init) => {
    calls.push({ url, init });
    return json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
  });
  const url = new URL(service.getAuthUrl('state-1'));
  assert.equal(url.searchParams.get('client_id'), 'test-client');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.has('client_secret'), false);
  const challenge = url.searchParams.get('code_challenge');
  assert.ok(challenge, 'the authorize URL carries a code challenge');
  assert.equal(calls.length, 0, 'nothing is sent to Spotify before the callback');

  await service.handleAuthCallback('the-code', 'state-1');
  assert.equal(calls.length, 1);
  const init = calls[0]?.init;
  assert.ok(init);
  assert.equal(init.headers['Authorization'], undefined, 'no client secret, so no Basic authorization');
  const body = init.body;
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('code'), 'the-code');
  assert.equal(body.get('client_id'), 'test-client');
  assert.equal(body.has('client_secret'), false);
  const verifier = body.get('code_verifier');
  assert.ok(verifier);
  assert.match(verifier, /^[A-Za-z0-9_-]{43,128}$/, 'RFC 7636 verifier alphabet and length');
  assert.equal(createHash('sha256').update(verifier).digest('base64url'), challenge);
});

test('each sign-in gets its own verifier', async t => {
  const { service } = await setup(t, async () => json({}));
  const first = new URL(service.getAuthUrl('a')).searchParams.get('code_challenge');
  const second = new URL(service.getAuthUrl('b')).searchParams.get('code_challenge');
  assert.notEqual(first, second);
});

test('refreshing a login sends the client ID but no secret', async t => {
  /** @type {{ url: string, init: TokenRequestInit }[]} */
  const calls = [];
  const { service } = await setup(t, async (url, init) => {
    calls.push({ url, init });
    return json({ access_token: `access-${calls.length}`, refresh_token: 'refresh', expires_in: 3600 });
  });
  await signIn(service);
  service.tokenExpiresAt = 0;
  assert.equal(await service.getValidAccessToken(), 'access-2');
  const init = calls[1]?.init;
  assert.ok(init);
  assert.equal(init.headers['Authorization'], undefined);
  assert.equal(init.body.get('grant_type'), 'refresh_token');
  assert.equal(init.body.get('refresh_token'), 'refresh');
  assert.equal(init.body.get('client_id'), 'test-client');
  assert.equal(init.body.has('client_secret'), false);
  assert.equal(init.body.has('code_verifier'), false);
});

test('a callback for a sign-in that was not started here is refused without calling Spotify', async t => {
  let requests = 0;
  const { service } = await setup(t, async () => {
    requests++;
    return json({});
  });
  await assert.rejects(service.handleAuthCallback('code', 'never-started'), { status: 400 });
  assert.equal(requests, 0);
});

test('a code verifier works once', async t => {
  let requests = 0;
  const { service } = await setup(t, async () => {
    requests++;
    return json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
  });
  service.getAuthUrl('once');
  await service.handleAuthCallback('code', 'once');
  await assert.rejects(service.handleAuthCallback('code', 'once'), { status: 400 });
  assert.equal(requests, 1);
});

test('an abandoned sign-in expires', async t => {
  const { service } = await setup(t, async () => json({}));
  service.getAuthUrl('old');
  const pending = service.pendingSignIns.get('old');
  assert.ok(pending);
  pending.expiresAt = Date.now() - 1;
  await assert.rejects(service.handleAuthCallback('code', 'old'), { status: 400 });
});

test('abandoned sign-ins cannot pile up', async t => {
  const { service } = await setup(t, async () => json({}));
  for (let i = 0; i < 50; i++) service.getAuthUrl(`state-${i}`);
  assert.ok(service.pendingSignIns.size <= 20);
  assert.equal(service.pendingSignIns.has('state-0'), false, 'the oldest is dropped first');
  assert.equal(service.pendingSignIns.has('state-49'), true);
});

test('only the client ID is needed to sign in', async t => {
  const { service } = await setup(t, async () => json({}));
  assert.equal(service.isConfigured(), true);
  const unconfigured = new SpotifyService({
    dataDir: service.tokenFile,
    clientId: '',
    redirectUri: 'http://127.0.0.1:3000/api/auth/callback'
  });
  assert.equal(unconfigured.isConfigured(), false);
  assert.throws(() => unconfigured.getAuthUrl('state'), { status: 400, message: /SPOTIFY_CLIENT_ID/ });
});
