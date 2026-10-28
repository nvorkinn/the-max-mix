import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SpotifyError, SpotifyService } from '../src/spotify.js';

async function setup(t, fetchImpl) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'max-mix-auth-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const options = {
    dataDir,
    clientId: 'test-client',
    clientSecret: 'test-secret',
    redirectUri: 'http://127.0.0.1:3000/api/auth/callback',
    fetchImpl
  };
  const service = new SpotifyService(options);
  await service.initialize();
  return { service, options };
}
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });

test('OAuth persists only the refresh token with owner-only permissions and restores after restart', async t => {
  const calls = [];
  const { service, options } = await setup(t, async (url, init) => {
    calls.push({ url, init });
    return json({ access_token: `access-${calls.length}`, refresh_token: `refresh-${calls.length}`, expires_in: 3600 });
  });
  assert.equal(await service.handleAuthCallback('authorization-code'), 'access-1');
  const stored = JSON.parse(await readFile(service.tokenFile, 'utf8'));
  assert.deepEqual(stored, { clientId: 'test-client', refreshToken: 'refresh-1' });
  assert.equal((await stat(service.tokenFile)).mode & 0o777, 0o600);
  const restarted = new SpotifyService(options);
  await restarted.initialize();
  assert(restarted.isAuthenticated());
  const tokens = await Promise.all([restarted.getValidAccessToken(), restarted.getValidAccessToken()]);
  assert.deepEqual(tokens, ['access-2', 'access-2']);
  assert.equal(calls.length, 2, 'Concurrent callers share a single refresh');
  assert.equal(calls[1].init.body.get('refresh_token'), 'refresh-1');
  assert.equal(JSON.parse(await readFile(service.tokenFile, 'utf8')).refreshToken, 'refresh-2');
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
  await service.handleAuthCallback('code');
  service.tokenExpiresAt = 0;
  revoked = true;
  await assert.rejects(service.getValidAccessToken(), error => error.status === 401);
  assert.equal(service.isAuthenticated(), false);
  await assert.rejects(readFile(service.tokenFile), error => error.code === 'ENOENT');
});

test('a non-JSON 400 from the token endpoint is a SpotifyError and keeps the saved login', async t => {
  let broken = false;
  const { service } = await setup(t, async () =>
    broken
      ? new Response('<html>Bad Request</html>', { status: 400 })
      : json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 })
  );
  await service.handleAuthCallback('code');
  service.tokenExpiresAt = 0;
  broken = true;
  await assert.rejects(service.getValidAccessToken(), error => error instanceof SpotifyError && error.status === 502);
  assert(service.isAuthenticated());
  assert.equal(JSON.parse(await readFile(service.tokenFile, 'utf8')).refreshToken, 'refresh');
});

test('real API requests use bearer auth, refresh once on 401, and preserve 204 responses', async t => {
  let playerCalls = 0;
  const { service } = await setup(t, async (url, init) => {
    if (url.endsWith('/api/token')) return json({ access_token: 'valid', refresh_token: 'refresh', expires_in: 3600 });
    assert.equal(init.headers.Authorization, 'Bearer valid');
    playerCalls++;
    return playerCalls === 1 ? json({}, 401) : new Response(null, { status: 204 });
  });
  await service.handleAuthCallback('code');
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
  await service.handleAuthCallback('code');
  await assert.rejects(service.next(), error => error.status === 429 && error.retryAfter === '30');
  status = 403;
  await assert.rejects(service.next(), error => error.status === 403 && /Premium/.test(error.message));
});
