import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { SpotifyError } from '../src/spotify.js';

async function start(t, { demoMode = false, overrides = {}, playbackMode = 'remote', distPath, rateLimits } = {}) {
  const calls = [];
  const spotify = {
    isConfigured: () => true,
    isAuthenticated: () => true,
    getValidAccessToken: async () => 'secret-access-token',
    getPlaybackState: async () => null,
    getQueue: async () => ({ currently_playing: null, queue: [] }),
    spotifyFetch: async () => ({ devices: [] }),
    getAuthUrl: state => `https://accounts.spotify.com/authorize?state=${state}`,
    handleAuthCallback: async code => calls.push(['auth', code]),
    ...Object.fromEntries(['play', 'pause', 'next', 'previous', 'seek', 'setVolume', 'transferPlayback'].map(action => [
      action, async (...args) => calls.push([action, ...args])
    ])),
    ...overrides
  };
  const app = createApp({ config: { demoMode, playbackMode, port: 3000 }, spotify, distPath, rateLimits });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (endpoint, body) => {
    const response = await fetch(base + endpoint, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual'
    });
    return { response, data: response.headers.get('Content-Type')?.includes('json') ? await response.json() : null };
  };
  return { request, calls, base };
}

test('remote mode does not expose browser tokens, and unauthenticated live mode is not demo', async t => {
  const { request } = await start(t, { overrides: { getValidAccessToken: async () => null, isAuthenticated: () => false } });
  const { data } = await request('/api/token');
  assert.equal(data.token, null);
  assert.equal(data.authenticated, false);
  assert.equal(data.demoMode, false);
  assert.equal(data.playbackMode, 'remote');
});

test('empty real device and queue results stay empty with no invented contributors', async t => {
  const { request } = await start(t, { overrides: { getQueue: async () => ({ queue: [{ id: 'real-track', name: 'Real track' }] }) } });
  assert.deepEqual((await request('/api/spotify/devices')).data, { devices: [] });
  assert.deepEqual((await request('/api/queue')).data.queue, [{ id: 'real-track', name: 'Real track' }]);
  assert.equal((await request('/api/spotify/current')).data, null);
  for (const endpoint of ['/api/queue/reorder', '/api/queue/play-now']) {
    assert.equal((await request(endpoint, {})).response.status, 409);
  }
});

test('live controls call Spotify exactly once with validated arguments', async t => {
  const { request, calls } = await start(t);
  for (const action of ['play', 'pause', 'next', 'previous']) assert.equal((await request(`/api/spotify/${action}`, {})).response.status, 200);
  await request('/api/spotify/seek', { position_ms: 12000 });
  await request('/api/spotify/volume', { volume_percent: 0 });
  await request('/api/transfer', { deviceId: 'actual-speaker' });
  assert.deepEqual(calls, [['play'], ['pause'], ['next'], ['previous'], ['seek', 12000], ['setVolume', 0], ['transferPlayback', 'actual-speaker', false]]);
  for (const value of [-1, 101, '50', null, 1.5]) assert.equal((await request('/api/spotify/volume', { volume_percent: value })).response.status, 400);
  assert.equal((await request('/api/spotify/seek', { position_ms: -1 })).response.status, 400);
  assert.equal((await request('/api/transfer', { deviceId: '' })).response.status, 400);
  assert.equal(calls.length, 7);
});

test('upstream errors remain errors, including rate-limit headers', async t => {
  const { request } = await start(t, { overrides: {
    getQueue: async () => { throw new SpotifyError('Spotify rate limit reached.', 429, '45'); },
    next: async () => { throw new SpotifyError('No active device.', 404); }
  } });
  const queue = await request('/api/queue');
  assert.equal(queue.response.status, 429);
  assert.equal(queue.response.headers.get('Retry-After'), '45');
  assert.equal(queue.data.queue, undefined);
  assert.equal((await request('/api/spotify/next', {})).response.status, 404);
});

test('OAuth requires the matching state cookie before exchanging a code', async t => {
  const { base, calls } = await start(t);
  const login = await fetch(`${base}/api/auth/login`, { redirect: 'manual' });
  const state = new URL(login.headers.get('Location')).searchParams.get('state');
  const cookie = login.headers.get('Set-Cookie').split(';')[0];
  assert.equal((await fetch(`${base}/api/auth/callback?code=code&state=wrong`, { headers: { Cookie: cookie } })).status, 400);
  assert.deepEqual(calls, []);
  const callback = await fetch(`${base}/api/auth/callback?code=code&state=${state}`, { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(callback.status, 302);
  assert.deepEqual(calls, [['auth', 'code']]);
});

test('explicit demo controls share backend state without calling Spotify', async t => {
  const { request, calls } = await start(t, { demoMode: true });
  const initial = (await request('/api/queue')).data.queue;
  assert.equal((await request('/api/queue/reorder', { queue: initial.toReversed() })).response.status, 200);
  assert.equal((await request('/api/queue')).data.queue[0].id, initial.at(-1).id);
  assert.equal((await request('/api/queue/reorder', { queue: [] })).response.status, 400);
  await request('/api/queue/play-now', { trackId: initial[0].id });
  assert.equal((await request('/api/spotify/current')).data.item.id, initial[0].id);
  await request('/api/spotify/pause', {});
  await request('/api/spotify/seek', { position_ms: 1234 });
  await request('/api/spotify/volume', { volume_percent: 0 });
  const state = (await request('/api/spotify/current')).data;
  assert.equal(state.is_playing, false);
  assert.equal(state.progress_ms, 1234);
  assert.equal(state.device.volume_percent, 0);
  assert.deepEqual(calls, []);
});

test('health fails when production frontend is missing', async t => {
  const { request } = await start(t, { distPath: '/nonexistent-max-mix-build' });
  assert.equal((await request('/api/health')).response.status, 503);
});

test('API, sign-in and page requests are rate limited per client with a JSON 429', async t => {
  const dist = await mkdtemp(path.join(os.tmpdir(), 'max-mix-dist-'));
  t.after(() => rm(dist, { recursive: true, force: true }));
  await writeFile(path.join(dist, 'index.html'), '<!doctype html>');
  const { request, base } = await start(t, { distPath: dist, rateLimits: { api: 100, auth: 2, pages: 3 } });

  assert.equal((await request('/api/auth/login')).response.status, 302);
  assert.equal((await request('/api/auth/login')).response.status, 302);
  const limited = await request('/api/auth/login');
  assert.equal(limited.response.status, 429);
  assert.match(limited.data.error, /Too many requests/);
  assert(limited.response.headers.get('RateLimit'), 'standard rate limit headers are sent');
  assert.equal((await request('/api/info')).response.status, 200, 'the sign-in limit does not affect other routes');

  for (const route of ['/', '/deep/link', '/another']) assert.equal((await fetch(base + route)).status, 200);
  assert.equal((await fetch(base + '/blocked')).status, 429);
});

test('the general API limit applies across API routes', async t => {
  const { request } = await start(t, { rateLimits: { api: 3 } });
  for (const endpoint of ['/api/info', '/api/token', '/api/spotify/devices']) assert.equal((await request(endpoint)).response.status, 200);
  assert.equal((await request('/api/info')).response.status, 429);
});
