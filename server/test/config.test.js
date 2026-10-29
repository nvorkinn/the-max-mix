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

test('PUBLIC_URL sets the callback, the accepted host and trust of one proxy, and wins over SPOTIFY_REDIRECT_URI', () => {
  const config = parseConfig({
    PUBLIC_URL: 'https://maxmix.example.com',
    SPOTIFY_REDIRECT_URI: 'https://elsewhere.example.com/other/callback',
    ALLOWED_HOSTS: 'pi.local'
  });
  assert.equal(config.redirectUri, 'https://maxmix.example.com/api/auth/callback');
  assert.deepEqual(config.allowedHosts, ['pi.local', 'maxmix.example.com']);
  assert.equal(config.trustProxy, 1);
  assert.equal(parseConfig({}).trustProxy, 0);
  assert.equal(parseConfig({ PUBLIC_URL: 'https://maxmix.example.com', TRUST_PROXY: '2' }).trustProxy, 2);
  assert.equal(parseConfig({ TRUST_PROXY: '1' }).trustProxy, 1);
});

test('rejects a PUBLIC_URL or TRUST_PROXY that is not what it says', () => {
  for (const env of [
    { PUBLIC_URL: 'maxmix.example.com' },
    { PUBLIC_URL: ['http', 'maxmix.example.com'].join('://') },
    { PUBLIC_URL: 'https://maxmix.example.com/app' },
    { PUBLIC_URL: 'https://user@maxmix.example.com' },
    { TRUST_PROXY: 'yes' },
    { TRUST_PROXY: '-1' }
  ]) {
    assert.throws(() => parseConfig(env));
  }
});

test('Cloudflare Access is required behind a public address, and only configured with both of its settings', () => {
  const audience = 'a'.repeat(64);
  assert.deepEqual(parseConfig({}).access, { required: false, teamDomain: '', audience: '', configured: false });
  assert.deepEqual(parseConfig({ PUBLIC_URL: 'https://maxmix.example.com' }).access, {
    required: true,
    teamDomain: '',
    audience: '',
    configured: false
  });
  assert.deepEqual(
    parseConfig({
      PUBLIC_URL: 'https://maxmix.example.com',
      ACCESS_TEAM_DOMAIN: 'Team.CloudflareAccess.com',
      ACCESS_AUD: audience
    }).access,
    { required: true, teamDomain: 'team.cloudflareaccess.com', audience, configured: true }
  );
  // Setting the team alone is a sign the operator wants Access, so it is required without a public address too.
  assert.equal(parseConfig({ ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com' }).access.required, true);
  // Opting out of it behind a public address is explicit.
  assert.equal(
    parseConfig({ PUBLIC_URL: 'https://maxmix.example.com', ACCESS_REQUIRED: 'false' }).access.required,
    false
  );
});

test('rejects Access settings that are not a Cloudflare team domain, an audience tag or true/false', () => {
  for (const env of [
    { ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com' },
    { ACCESS_TEAM_DOMAIN: 'attacker.example.com' },
    { ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com.attacker.example' },
    { ACCESS_AUD: 'short' },
    { ACCESS_AUD: 'not an audience tag!!!!!!!!!!!!' },
    { ACCESS_REQUIRED: 'maybe' }
  ]) {
    assert.throws(() => parseConfig(env));
  }
});
