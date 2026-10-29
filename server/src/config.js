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

const REDIRECT_PATH = '/api/auth/callback';

/**
 * PUBLIC_URL is the address the app is reached at when it sits behind a reverse proxy (for example
 * https://maxmix.example.com): it sets the Spotify redirect URI and the host name the app accepts.
 * @param {string | undefined} value
 */
function parsePublicUrl(value) {
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('PUBLIC_URL must be an absolute URL such as https://maxmix.example.com.');
  }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username) {
    throw new Error('PUBLIC_URL must be an https:// address with no path, such as https://maxmix.example.com.');
  }
  return url;
}

/** @param {string | undefined} value */
function parseTrustProxy(value) {
  if (!value) return null;
  if (!/^\d{1,2}$/.test(value)) {
    throw new Error('TRUST_PROXY must be the number of reverse proxies in front of the app.');
  }
  return Number(value);
}

/** @param {NodeJS.ProcessEnv} env */
export function parseConfig(env) {
  const port = Number(env['PORT'] || 3000);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const playbackMode = env['PLAYBACK_MODE'] || 'browser';
  if (!['browser', 'remote'].includes(playbackMode)) throw new Error('PLAYBACK_MODE must be browser or remote.');
  if (env['DEMO_MODE'] && !['true', 'false'].includes(env['DEMO_MODE'])) {
    throw new Error('DEMO_MODE must be true or false.');
  }
  const publicUrl = parsePublicUrl(env['PUBLIC_URL']);
  const redirectUri = publicUrl
    ? `${publicUrl.origin}${REDIRECT_PATH}`
    : env['SPOTIFY_REDIRECT_URI'] || `http://127.0.0.1:${port}${REDIRECT_PATH}`;
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
    host: env['HOST'] || '127.0.0.1',
    allowedHosts: [
      ...(env['ALLOWED_HOSTS'] || '')
        .split(',')
        .map(host => host.trim())
        .filter(Boolean),
      ...(publicUrl ? [publicUrl.hostname] : [])
    ],
    trustProxy: parseTrustProxy(env['TRUST_PROXY']) ?? (publicUrl ? 1 : 0),
    demoMode: env['DEMO_MODE'] === 'true',
    playbackMode,
    clientId: env['SPOTIFY_CLIENT_ID'] || '',
    redirectUri,
    dataDir: path.resolve(
      env['STATE_DIRECTORY'] || env['DATA_DIR'] || path.join(os.homedir(), '.local/share/the-max-mix')
    )
  };
}
