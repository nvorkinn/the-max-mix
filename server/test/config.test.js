import assert from 'node:assert/strict';
import test from 'node:test';
import { parseConfig } from '../src/config.js';

test('configuration defaults to loopback, real playback, and a valid Spotify callback', () => {
  const config = parseConfig({});
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.demoMode, false);
  assert.equal(config.redirectUri, 'http://127.0.0.1:3000/api/auth/callback');
  assert.equal(
    parseConfig({ STATE_DIRECTORY: '/var/lib/the-max-mix', DATA_DIR: '/ignored-local-value' }).dataDir,
    '/var/lib/the-max-mix'
  );
});
test('rejects misleading configuration instead of silently choosing a mode', () => {
  for (const env of [
    { PLAYBACK_MODE: 'wrong' },
    { DEMO_MODE: 'yes' },
    { PORT: '3000oops' },
    { SPOTIFY_REDIRECT_URI: 'http://localhost:3000/api/auth/callback' },
    { SPOTIFY_REDIRECT_URI: 'http://192.168.1.2:3000/api/auth/callback' }
  ]) {
    assert.throws(() => parseConfig(env));
  }
  assert.equal(parseConfig({ PLAYBACK_MODE: 'remote', DEMO_MODE: 'true' }).demoMode, true);
});

test('ALLOWED_HOSTS is a trimmed comma-separated list', () => {
  assert.deepEqual(parseConfig({}).allowedHosts, []);
  assert.deepEqual(parseConfig({ ALLOWED_HOSTS: ' maxmix.lan, pi.local ,,' }).allowedHosts, ['maxmix.lan', 'pi.local']);
});
