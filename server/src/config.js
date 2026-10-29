import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/** @param {NodeJS.ProcessEnv} [env] */
export function loadConfig(env = process.env) {
  const result = dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), processEnv: env });
  if (result.error && result.error.code !== 'ENOENT') throw result.error;
  return parseConfig(env);
}

/** @param {NodeJS.ProcessEnv} env */
export function parseConfig(env) {
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const playbackMode = env.PLAYBACK_MODE || 'browser';
  if (!['browser', 'remote'].includes(playbackMode)) throw new Error('PLAYBACK_MODE must be browser or remote.');
  if (env.DEMO_MODE && !['true', 'false'].includes(env.DEMO_MODE)) throw new Error('DEMO_MODE must be true or false.');
  const redirectUri = env.SPOTIFY_REDIRECT_URI || `http://127.0.0.1:${port}/api/auth/callback`;
  const redirect = new URL(redirectUri);
  if (
    redirect.hostname === 'localhost' ||
    (redirect.protocol !== 'https:' &&
      !(redirect.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(redirect.hostname)))
  ) {
    throw new Error(
      'Spotify redirect URI must use HTTPS, or HTTP with the literal loopback address 127.0.0.1 or [::1].'
    );
  }
  return {
    port,
    host: env.HOST || '127.0.0.1',
    allowedHosts: (env.ALLOWED_HOSTS || '')
      .split(',')
      .map(host => host.trim())
      .filter(Boolean),
    demoMode: env.DEMO_MODE === 'true',
    playbackMode,
    clientId: env.SPOTIFY_CLIENT_ID || '',
    redirectUri,
    dataDir: path.resolve(env.STATE_DIRECTORY || env.DATA_DIR || path.join(os.homedir(), '.local/share/the-max-mix'))
  };
}
