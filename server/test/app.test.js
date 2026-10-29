import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { SpotifyError } from '../src/spotify.js';

/**
 * The JSON bodies the API returns; each endpoint returns only some of these fields.
 * @typedef {{
 *   token: string | null, authenticated: boolean, demoMode: boolean, playbackMode: string, error: string,
 *   queue: { id: string }[], is_playing: boolean, progress_ms: number, device: { volume_percent: number },
 *   item: { id: string }
 * }} ApiBody
 */

/**
 * @param {import('node:test').TestContext} t
 * @param {{ demoMode?: boolean, overrides?: Record<string, unknown>, playbackMode?: string, distPath?: string,
 *   rateLimits?: Partial<{ windowMs: number, api: number, auth: number, pages: number }>, allowedHosts?: string[] }} [options]
 */
async function start(
  t,
  { demoMode = false, overrides = {}, playbackMode = 'remote', distPath, rateLimits, allowedHosts = [] } = {}
) {
  /** @type {unknown[][]} */
  const calls = [];
  const spotify = {
    isConfigured: () => true,
    isAuthenticated: () => true,
    getValidAccessToken: async () => 'secret-access-token',
    getPlaybackState: async () => null,
    getQueue: async () => ({ currently_playing: null, queue: [] }),
    getDevices: async () => ({ devices: [] }),
    /** @param {string} state */
    getAuthUrl: state => `https://accounts.spotify.com/authorize?state=${state}`,
    /**
     * @param {string} code
     * @param {string} state
     */
    handleAuthCallback: async (code, state) => {
      calls.push(['auth', code, state]);
    },
    ...Object.fromEntries(
      ['play', 'pause', 'next', 'previous', 'seek', 'setVolume', 'transferPlayback'].map(action => [
        action,
        /** @param {unknown[]} args */
        async (...args) => {
          calls.push([action, ...args]);
        }
      ])
    ),
    ...overrides
  };
  const app = createApp({
    config: { demoMode, playbackMode, port: 3000, allowedHosts },
    spotify: /** @type {import('../src/spotify.js').SpotifyService} */ (/** @type {unknown} */ (spotify)),
    ...(distPath !== undefined && { distPath }),
    ...(rateLimits !== undefined && { rateLimits })
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
  /**
   * @param {string} endpoint
   * @param {unknown} [body]
   */
  const request = async (endpoint, body) => {
    const response = await fetch(base + endpoint, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      redirect: 'manual'
    });
    /** @type {unknown} */
    const data = response.headers.get('Content-Type')?.includes('json') ? await response.json() : null;
    return { response, data: /** @type {ApiBody} */ (data) };
  };
  return { request, calls, base };
}

test('remote mode does not expose browser tokens, and unauthenticated live mode is not demo', async t => {
  const { request } = await start(t, {
    overrides: { getValidAccessToken: async () => null, isAuthenticated: () => false }
  });
  const { data } = await request('/api/token');
  assert.equal(data.token, null);
  assert.equal(data.authenticated, false);
  assert.equal(data.demoMode, false);
  assert.equal(data.playbackMode, 'remote');
});

test('empty real device and queue results stay empty with no invented contributors', async t => {
  const { request } = await start(t, {
    overrides: { getQueue: async () => ({ queue: [{ id: 'real-track', name: 'Real track' }] }) }
  });
  assert.deepEqual((await request('/api/spotify/devices')).data, { devices: [] });
  assert.deepEqual((await request('/api/queue')).data.queue, [{ id: 'real-track', name: 'Real track' }]);
  assert.equal((await request('/api/spotify/current')).data, null);
  for (const endpoint of ['/api/queue/reorder', '/api/queue/play-now']) {
    assert.equal((await request(endpoint, {})).response.status, 409);
  }
});

test('live controls call Spotify exactly once with validated arguments', async t => {
  const { request, calls } = await start(t);
  for (const action of ['play', 'pause', 'next', 'previous']) {
    assert.equal((await request(`/api/spotify/${action}`, {})).response.status, 200);
  }
  await request('/api/spotify/seek', { position_ms: 12000 });
  await request('/api/spotify/volume', { volume_percent: 0 });
  await request('/api/transfer', { deviceId: 'actual-speaker' });
  assert.deepEqual(calls, [
    ['play'],
    ['pause'],
    ['next'],
    ['previous'],
    ['seek', 12000],
    ['setVolume', 0],
    ['transferPlayback', 'actual-speaker', false]
  ]);
  for (const value of [-1, 101, '50', null, 1.5]) {
    assert.equal((await request('/api/spotify/volume', { volume_percent: value })).response.status, 400);
  }
  assert.equal((await request('/api/spotify/seek', { position_ms: -1 })).response.status, 400);
  assert.equal((await request('/api/transfer', { deviceId: '' })).response.status, 400);
  assert.equal(calls.length, 7);
});

test('upstream errors remain errors, including rate-limit headers', async t => {
  const { request } = await start(t, {
    overrides: {
      getQueue: async () => {
        throw new SpotifyError('Spotify rate limit reached.', 429, '45');
      },
      next: async () => {
        throw new SpotifyError('No active device.', 404);
      }
    }
  });
  const queue = await request('/api/queue');
  assert.equal(queue.response.status, 429);
  assert.equal(queue.response.headers.get('Retry-After'), '45');
  assert.equal(queue.data.queue, undefined);
  assert.equal((await request('/api/spotify/next', {})).response.status, 404);
});

test('OAuth requires the matching state cookie before exchanging a code', async t => {
  const { base, calls } = await start(t);
  const login = await fetch(`${base}/api/auth/login`, { redirect: 'manual' });
  const state = new URL(/** @type {string} */ (login.headers.get('Location'))).searchParams.get('state');
  const cookie = /** @type {string} */ (login.headers.get('Set-Cookie')).split(';', 1)[0] ?? '';
  assert.equal(
    (await fetch(`${base}/api/auth/callback?code=code&state=wrong`, { headers: { Cookie: cookie } })).status,
    400
  );
  assert.deepEqual(calls, []);
  const callback = await fetch(`${base}/api/auth/callback?code=code&state=${state}`, {
    headers: { Cookie: cookie },
    redirect: 'manual'
  });
  assert.equal(callback.status, 302);
  assert.deepEqual(calls, [['auth', 'code', state]]);
});

test('explicit demo controls share backend state without calling Spotify', async t => {
  const { request, calls } = await start(t, { demoMode: true });
  const initial = (await request('/api/queue')).data.queue;
  const first = initial[0];
  const last = initial.at(-1);
  assert.ok(first && last);
  assert.equal((await request('/api/queue/reorder', { queue: initial.toReversed() })).response.status, 200);
  assert.equal((await request('/api/queue')).data.queue[0]?.id, last.id);
  assert.equal((await request('/api/queue/reorder', { queue: [] })).response.status, 400);
  await request('/api/queue/play-now', { trackId: first.id });
  assert.equal((await request('/api/spotify/current')).data.item.id, first.id);
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
  assert.ok(limited.response.headers.get('RateLimit'), 'standard rate limit headers are sent');
  assert.equal((await request('/api/info')).response.status, 200, 'the sign-in limit does not affect other routes');

  for (const route of ['/', '/deep/link', '/another']) assert.equal((await fetch(`${base}${route}`)).status, 200);
  assert.equal((await fetch(`${base}/blocked`)).status, 429);
});

test('the general API limit applies across API routes', async t => {
  const { request } = await start(t, { rateLimits: { api: 3 } });
  for (const endpoint of ['/api/info', '/api/token', '/api/spotify/devices']) {
    assert.equal((await request(endpoint)).response.status, 200);
  }
  assert.equal((await request('/api/info')).response.status, 429);
});

// fetch() cannot set Host or Sec-Fetch-* headers, so these tests use node:http.
/**
 * @param {string} base
 * @param {{ method?: string, endpoint: string, headers?: http.OutgoingHttpHeaders, body?: string }} options
 */
function rawRequest(base, { method = 'GET', endpoint, headers = {}, body }) {
  const { hostname, port } = new URL(base);
  return /** @type {Promise<{ status: number | undefined, text: string }>} */ (
    new Promise((resolve, reject) => {
      const request = http.request({ hostname, port, path: endpoint, method, headers }, response => {
        let text = '';
        response.on('data', (/** @type {Buffer} */ chunk) => {
          text += chunk.toString();
        });
        response.on('end', () => resolve({ status: response.statusCode, text }));
      });
      request.on('error', reject);
      request.end(body);
    })
  );
}

test('state-changing requests from other websites are refused and have no effect', async t => {
  const { base, request } = await start(t, { demoMode: true });
  const json = { 'Content-Type': 'application/json' };
  /** @param {http.OutgoingHttpHeaders} headers */
  const pause = headers => rawRequest(base, { method: 'POST', endpoint: '/api/spotify/pause', headers, body: '{}' });
  const playing = async () => (await request('/api/spotify/current')).data.is_playing;

  assert.equal(await playing(), true);
  for (const headers of [
    { ...json, 'Sec-Fetch-Site': 'cross-site' },
    { ...json, 'Sec-Fetch-Site': 'same-site' },
    { ...json, Origin: 'https://evil.example' },
    { ...json, Origin: 'null' },
    { 'Content-Type': 'text/plain', 'Sec-Fetch-Site': 'cross-site', Origin: 'https://evil.example' }
  ]) {
    assert.equal((await pause(headers)).status, 403, JSON.stringify(headers));
  }
  assert.equal(await playing(), true, 'refused requests did not pause playback');

  assert.equal((await pause({ 'Content-Type': 'text/plain' })).status, 415, 'a same-origin client must send JSON');
  assert.equal((await pause({})).status, 415);
  assert.equal(await playing(), true);

  const host = new URL(base).host;
  for (const headers of [
    json,
    { ...json, 'Sec-Fetch-Site': 'same-origin' },
    { ...json, 'Sec-Fetch-Site': 'none' },
    { ...json, Origin: `http://${host}` }
  ]) {
    assert.equal((await pause(headers)).status, 200, JSON.stringify(headers));
  }
  assert.equal(await playing(), false);
});

test('safe requests are not blocked as cross-site, so the Spotify sign-in redirect still works', async t => {
  const { base } = await start(t, { demoMode: true });
  const response = await rawRequest(base, {
    endpoint: '/api/info',
    headers: { 'Sec-Fetch-Site': 'cross-site', Origin: 'https://accounts.spotify.com' }
  });
  assert.equal(response.status, 200);
});

test('unknown Host headers are refused, while IP addresses, localhost and configured names work', async t => {
  const { base } = await start(t, { demoMode: true, allowedHosts: ['maxmix.example.lan'] });
  /** @param {string} host */
  const get = host => rawRequest(base, { endpoint: '/api/token', headers: { Host: host } });
  for (const host of [
    'evil.example',
    'evil.example:3000',
    'rebind.attacker.test',
    'localhost.evil.example',
    '127.0.0.1.evil.example'
  ]) {
    assert.equal((await get(host)).status, 403, host);
  }
  for (const host of [
    '127.0.0.1:3000',
    '192.168.1.20',
    '[::1]:3000',
    'localhost:3000',
    'LocalHost',
    'maxmix.example.lan:3000'
  ]) {
    assert.equal((await get(host)).status, 200, host);
  }
  assert.equal((await get(`${os.hostname()}.local:3000`)).status, 200);
});
