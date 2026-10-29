import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createStaticServer } from '../serve.mjs';

const SERVE_SCRIPT = path.resolve(import.meta.dirname, '../serve.mjs');
const INDEX_HTML = '<!doctype html><title>THE MAX MIX</title>';

const sandbox = await mkdtemp(path.join(tmpdir(), 'serve-test-'));
const distDir = path.join(sandbox, 'dist');

before(async () => {
  await mkdir(path.join(distDir, 'assets'), { recursive: true });
  await writeFile(path.join(distDir, 'index.html'), INDEX_HTML);
  await writeFile(path.join(distDir, 'assets', 'app-abc123.js'), 'console.log("app");');
  await writeFile(path.join(distDir, 'assets', 'app-abc123.css'), 'body{margin:0}');
  await writeFile(path.join(distDir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(path.join(distDir, '.hidden'), 'secret');
  await writeFile(path.join(sandbox, 'outside.txt'), 'outside the dist folder');
});

after(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

/**
 * Starts a server on a free loopback port for the callback, then closes it.
 * @param {string} dir
 * @param {(origin: { host: string, port: number }) => Promise<void>} run
 */
async function withServer(dir, run) {
  const server = createStaticServer({ distDir: dir });
  await new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve(true);
    });
  });
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  try {
    await run({ host: '127.0.0.1', port: address.port });
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => {
      server.close(() => {
        resolve(true);
      });
    });
  }
}

/**
 * A raw request, so paths reach the server exactly as written (fetch would normalise dot segments).
 * @param {{ host: string, port: number }} origin
 * @param {string} requestPath
 * @param {{ method?: string, headers?: Record<string, string> }} [options]
 * @returns {Promise<{ status: number, headers: import('node:http').IncomingHttpHeaders, body: string }>}
 */
function request(origin, requestPath, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ ...origin, path: requestPath, method, headers }, res => {
      const chunks = /** @type {Buffer[]} */ ([]);
      res.on('data', (/** @type {Buffer} */ chunk) => {
        chunks.push(chunk);
      });
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Runs serve.mjs as a child process and waits for its "served at" line.
 * @param {Record<string, string>} env
 * @returns {Promise<{ child: import('node:child_process').ChildProcess, url: URL, output: () => string }>}
 */
function startScript(env) {
  const child = spawn(process.execPath, [SERVE_SCRIPT], {
    env: { PATH: process.env['PATH'] ?? '', DIST_DIR: distDir, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let collected = '';
  return new Promise((resolve, reject) => {
    /** @param {Buffer} chunk */
    const onData = chunk => {
      collected += chunk.toString('utf8');
      const match = /served at (http:\/\/\S+)/.exec(collected);
      if (match?.[1]) resolve({ child, url: new URL(match[1]), output: () => collected });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', reject);
    child.on('exit', code => {
      reject(new Error(`serve.mjs exited with ${String(code)} before listening: ${collected}`));
    });
  });
}

/** @param {import('node:child_process').ChildProcess} child */
function stop(child) {
  return new Promise(resolve => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }
    child.removeAllListeners('exit');
    child.on('exit', (code, signal) => {
      resolve(signal ?? code);
    });
    child.kill('SIGTERM');
  });
}

describe('static files', () => {
  test('serves index.html at the root with revalidation and the security headers', async () => {
    await withServer(distDir, async origin => {
      const res = await request(origin, '/');
      assert.equal(res.status, 200);
      assert.equal(res.body, INDEX_HTML);
      assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
      assert.equal(res.headers['cache-control'], 'no-cache');
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.equal(res.headers['referrer-policy'], 'same-origin');
      assert.equal(res.headers['content-security-policy'], undefined);
    });
  });

  test('serves built assets with the right type and long immutable caching', async () => {
    await withServer(distDir, async origin => {
      const script = await request(origin, '/assets/app-abc123.js');
      assert.equal(script.status, 200);
      assert.equal(script.body, 'console.log("app");');
      assert.equal(script.headers['content-type'], 'text/javascript; charset=utf-8');
      assert.equal(script.headers['cache-control'], 'public, max-age=31536000, immutable');
      assert.equal(script.headers['x-content-type-options'], 'nosniff');

      const style = await request(origin, '/assets/app-abc123.css');
      assert.equal(style.headers['content-type'], 'text/css; charset=utf-8');
      assert.equal(style.headers['cache-control'], 'public, max-age=31536000, immutable');
    });
  });

  test('serves other files with revalidation and ignores the query string', async () => {
    await withServer(distDir, async origin => {
      const res = await request(origin, '/icon.svg?v=2');
      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], 'image/svg+xml');
      assert.equal(res.headers['cache-control'], 'no-cache');
    });
  });

  test('answers a repeated request with 304 when the ETag matches', async () => {
    await withServer(distDir, async origin => {
      const first = await request(origin, '/assets/app-abc123.js');
      const etag = String(first.headers.etag);
      const second = await request(origin, '/assets/app-abc123.js', { headers: { 'If-None-Match': etag } });
      assert.equal(second.status, 304);
      assert.equal(second.body, '');
    });
  });
});

describe('single-page app fallback', () => {
  test('serves index.html for client-side routes', async () => {
    await withServer(distDir, async origin => {
      for (const route of ['/settings', '/queue/now-playing', '/some/deep/route/']) {
        const res = await request(origin, route);
        assert.equal(res.status, 200, route);
        assert.equal(res.body, INDEX_HTML, route);
        assert.equal(res.headers['cache-control'], 'no-cache', route);
      }
    });
  });

  test('serves index.html for the Spotify redirect with a code in the query', async () => {
    await withServer(distDir, async origin => {
      const res = await request(origin, '/?code=abc&state=xyz');
      assert.equal(res.status, 200);
      assert.equal(res.body, INDEX_HTML);
    });
  });

  test('answers 404 for a missing file rather than index.html', async () => {
    await withServer(distDir, async origin => {
      for (const missing of ['/assets/missing.js', '/assets/missing', '/favicon.png', '/.hidden', '/assets/.hidden']) {
        const res = await request(origin, missing);
        assert.equal(res.status, 404, missing);
        assert.notEqual(res.body, INDEX_HTML, missing);
      }
    });
  });

  test('answers 404 for unknown /api paths', async () => {
    await withServer(distDir, async origin => {
      assert.equal((await request(origin, '/api/info')).status, 404);
      assert.equal((await request(origin, '/api/auth/login')).status, 404);
    });
  });
});

describe('health', () => {
  test('answers 200 {"ready":true} when the build exists', async () => {
    await withServer(distDir, async origin => {
      const res = await request(origin, '/api/health');
      assert.equal(res.status, 200);
      assert.deepEqual(JSON.parse(res.body), { ready: true });
      assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
    });
  });

  test('answers 503 when the build is missing, for health and for pages', async () => {
    await withServer(path.join(sandbox, 'no-such-dist'), async origin => {
      const health = await request(origin, '/api/health');
      assert.equal(health.status, 503);
      assert.deepEqual(JSON.parse(health.body), { ready: false });
      assert.equal((await request(origin, '/')).status, 503);
      assert.equal((await request(origin, '/settings')).status, 503);
    });
  });
});

describe('path traversal', () => {
  const attempts = [
    '/../outside.txt',
    '/assets/../../outside.txt',
    '/%2e%2e/outside.txt',
    '/%2E%2E/outside.txt',
    '/assets/%2e%2e/%2e%2e/outside.txt',
    '/..%2foutside.txt',
    '/%2e%2e%2foutside.txt',
    '/assets/..%2f..%2foutside.txt',
    '/..%5coutside.txt',
    '/assets\\..\\..\\outside.txt',
    '/%252e%252e/outside.txt',
    '//../outside.txt',
    '/./../outside.txt'
  ];

  test('never serves a file outside the dist folder', async () => {
    await withServer(distDir, async origin => {
      for (const attempt of attempts) {
        const res = await request(origin, attempt);
        assert.ok(!res.body.includes('outside the dist folder'), `${attempt} leaked a file`);
        assert.ok([400, 404].includes(res.status) || res.body === INDEX_HTML, `${attempt} gave ${res.status}`);
      }
    });
  });

  test('refuses encoded dot segments, null bytes and broken encoding with 400', async () => {
    await withServer(distDir, async origin => {
      for (const attempt of ['/%2e%2e%2foutside.txt', '/index.html%00.png', '/%00', '/%', '/%E0%A4%A', '/a%5cb']) {
        const res = await request(origin, attempt);
        assert.equal(res.status, 400, attempt);
      }
    });
  });

  test('refuses a request target that is not an absolute path', async () => {
    await withServer(distDir, async origin => {
      assert.equal((await request(origin, '*', { method: 'GET' })).status, 400);
    });
  });
});

describe('methods', () => {
  test('HEAD answers like GET with the same headers and no body', async () => {
    await withServer(distDir, async origin => {
      const get = await request(origin, '/assets/app-abc123.js');
      const head = await request(origin, '/assets/app-abc123.js', { method: 'HEAD' });
      assert.equal(head.status, 200);
      assert.equal(head.body, '');
      assert.equal(head.headers['content-length'], get.headers['content-length']);
      assert.equal(head.headers['content-type'], get.headers['content-type']);
      assert.equal(head.headers['cache-control'], get.headers['cache-control']);

      const health = await request(origin, '/api/health', { method: 'HEAD' });
      assert.equal(health.status, 200);
      assert.equal(health.body, '');
    });
  });

  test('answers 405 with an Allow header for any other method', async () => {
    await withServer(distDir, async origin => {
      for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
        const res = await request(origin, '/', { method });
        assert.equal(res.status, 405, method);
        assert.equal(res.headers.allow, 'GET, HEAD', method);
      }
      assert.equal((await request(origin, '/api/health', { method: 'POST' })).status, 405);
    });
  });
});

describe('the script', () => {
  test('listens on PORT and HOST, and exits cleanly on SIGTERM', async () => {
    const { child, url } = await startScript({ PORT: '0', HOST: '127.0.0.1' });
    try {
      assert.equal(url.hostname, '127.0.0.1');
      assert.notEqual(url.port, '');
      const res = await request({ host: url.hostname, port: Number(url.port) }, '/api/health');
      assert.equal(res.status, 200);
    } finally {
      assert.equal(await stop(child), 0);
    }
  });

  test('defaults to loopback when HOST is not set', async () => {
    const { child, url } = await startScript({ PORT: '0' });
    try {
      assert.equal(url.hostname, '127.0.0.1');
    } finally {
      await stop(child);
    }
  });

  test('refuses an invalid PORT', async () => {
    await assert.rejects(startScript({ PORT: 'abc' }), /PORT must be a whole number/);
  });
});
