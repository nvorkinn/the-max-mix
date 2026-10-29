// Serves the built client (client/dist) as plain static files; the app has no server of its own. Spotify needs an https
// or loopback redirect address and the Web Playback SDK needs a secure context, so the page cannot run from file://.
// No dependencies. Settings: PORT (default 3000), HOST (default 127.0.0.1), DIST_DIR (default client/dist).
// GET /api/health answers 200 {"ready":true}, or 503 while the build is missing (the path predates the static-only app
// and is kept so existing health checks keep working).
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const DEFAULT_DIST_DIR = path.resolve(import.meta.dirname, '../client/dist');
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';
const NOT_BUILT = 'The client is not built yet (npm run build)';
const ALLOWED_METHODS = 'GET, HEAD';

/** @type {Readonly<Record<string, string>>} */
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin'
};

/**
 * Sends a small complete response.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} contentType
 * @param {string} body
 * @param {boolean} headOnly
 * @param {Record<string, string>} [extraHeaders]
 */
function sendText(res, status, contentType, body, headOnly, extraHeaders = {}) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders
  });
  res.end(headOnly ? undefined : body);
}

/**
 * Turns a request target into a path inside the root, or says why it is refused. The target is decoded once, then every
 * segment is checked, so encoded dots and slashes (%2e%2e, %2f), backslashes and NUL bytes cannot reach outside.
 * @param {string | undefined} target
 * @returns {{ pathname: string, segments: string[] } | { error: string }}
 */
function parseTarget(target) {
  if (!target?.startsWith('/')) return { error: 'Bad request' };
  const raw = target.split(/[?#]/, 1)[0] ?? '';
  let pathname;
  try {
    pathname = decodeURIComponent(raw);
  } catch {
    return { error: 'Bad request' };
  }
  if (pathname.includes('\0') || pathname.includes('\\')) return { error: 'Bad request' };
  const segments = pathname.split('/').filter(segment => segment !== '');
  return segments.some(segment => segment === '..' || segment === '.')
    ? { error: 'Bad request' }
    : { pathname, segments };
}

/**
 * @param {string} file
 * @returns {Promise<import('node:fs').Stats | null>} the file's stats, or null when it is not a regular file
 */
async function statFile(file) {
  try {
    const stats = await stat(file);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

/**
 * Creates the static file server for a built client.
 * @param {{ distDir?: string }} [options]
 * @returns {import('node:http').Server}
 */
export function createStaticServer({ distDir = DEFAULT_DIST_DIR } = {}) {
  const root = path.resolve(distDir);
  const indexFile = path.join(root, 'index.html');

  /**
   * Finds the file for a request path. Client-side routes fall back to the app; a missing file (one with an extension,
   * or anything under /assets) is a 404.
   * @param {string} pathname
   * @param {string[]} segments
   * @returns {Promise<{ file: string, stats: import('node:fs').Stats } | { status: number, message: string }>}
   */
  async function locate(pathname, segments) {
    const file = path.join(root, ...segments);
    const stats = file.startsWith(root + path.sep) ? await statFile(file) : null;
    if (stats) return { file, stats };
    if (path.extname(pathname) !== '' || segments[0] === 'assets') return { status: 404, message: 'Not found' };
    const indexStats = await statFile(indexFile);
    return indexStats ? { file: indexFile, stats: indexStats } : { status: 503, message: NOT_BUILT };
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async function handle(req, res) {
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      sendText(res, 405, 'text/plain; charset=utf-8', 'Method not allowed', false, { Allow: ALLOWED_METHODS });
      return;
    }
    const headOnly = method === 'HEAD';

    const target = parseTarget(req.url);
    if ('error' in target) {
      sendText(res, 400, 'text/plain; charset=utf-8', target.error, headOnly);
      return;
    }
    const { pathname, segments } = target;
    const built = (await statFile(indexFile)) !== null;

    if (pathname === '/api/health') {
      sendText(res, built ? 200 : 503, 'application/json; charset=utf-8', JSON.stringify({ ready: built }), headOnly);
      return;
    }
    if (!built) {
      sendText(res, 503, 'text/plain; charset=utf-8', NOT_BUILT, headOnly);
      return;
    }
    if (segments[0] === 'api' || segments.some(segment => segment.startsWith('.'))) {
      sendText(res, 404, 'text/plain; charset=utf-8', 'Not found', headOnly);
      return;
    }

    const found = await locate(pathname, segments);
    if ('status' in found) {
      sendText(res, found.status, 'text/plain; charset=utf-8', found.message, headOnly);
      return;
    }
    const { file, stats } = found;

    const isIndex = file === indexFile;
    const etag = `W/"${stats.size.toString(16)}-${Math.trunc(stats.mtimeMs).toString(16)}"`;
    const headers = {
      ...SECURITY_HEADERS,
      'Cache-Control': !isIndex && segments[0] === 'assets' ? IMMUTABLE : REVALIDATE,
      'Content-Type': MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      ETag: etag
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': stats.size });
    if (headOnly) {
      res.end();
      return;
    }
    createReadStream(file)
      .on('error', () => {
        res.destroy();
      })
      .pipe(res);
  }

  return createServer((req, res) => {
    handle(req, res).catch(() => {
      if (res.headersSent) {
        res.destroy();
      } else {
        sendText(res, 500, 'text/plain; charset=utf-8', 'Internal error', false);
      }
    });
  });
}

/** @param {string | undefined} value */
function parsePort(value) {
  if (value === undefined || value === '') return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`PORT must be a whole number from 0 to 65535, got "${value}"`);
  }
  return port;
}

/** Starts the server from the environment and stops it on SIGTERM / SIGINT. */
function main() {
  const host = process.env['HOST'] || DEFAULT_HOST;
  const port = parsePort(process.env['PORT']);
  const server = createStaticServer({ distDir: process.env['DIST_DIR'] || DEFAULT_DIST_DIR });
  server.listen(port, host, () => {
    const address = server.address();
    const actual = typeof address === 'object' && address ? address.port : port;
    const name = host.includes(':') ? `[${host}]` : host;
    console.log(`THE MAX MIX is served at http://${name}:${actual}/`);
  });
  const stop = () => {
    server.close(() => {
      process.exit(0);
    });
    server.closeAllConnections();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main();
}
