// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { dump, KITCHEN, LOUNGE, silence } from './fixtures.ts';
import { parseDump, PipeWireError } from './pipewire.ts';
import type { Plan } from './pipewire.ts';
import { makeHandler, Router, validSpeakers } from './service.ts';
import type { AudioGraph } from './service.ts';

const ORIGIN = 'https://the-max-mix.vercel.app';

class FakePipeWire implements AudioGraph {
  applied: Plan[] = [];
  fail = false;

  graph() {
    return this.fail ? Promise.reject(new PipeWireError('down')) : Promise.resolve(parseDump(dump()));
  }

  apply(plan: Plan) {
    this.applied.push(plan);
    return Promise.resolve(true);
  }
}

describe('Router', () => {
  let directory: string;
  let state: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'kiosk-audio-'));
    state = path.join(directory, 'state', 'airplay.json');
    silence('info');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('lists the speakers', async () => {
    await expect(new Router(new FakePipeWire()).status()).resolves.toEqual({
      speakers: [
        { id: KITCHEN, nodeId: 50, name: 'Kitchen', selected: false },
        { id: LOUNGE, nodeId: 60, name: 'lounge', selected: false }
      ],
      selected: [],
      playing: true
    });
  });

  it('routes, saves the choice and keeps checking it', async () => {
    const fake = new FakePipeWire();
    const router = new Router(fake, state);
    const status = await router.choose([KITCHEN, KITCHEN]);
    expect(status.selected).toEqual([KITCHEN]);
    expect(fake.applied[0]?.connect).toEqual([
      [71, 51],
      [72, 52]
    ]);
    await router.reconcile();
    expect(fake.applied).toHaveLength(2); // the fake graph never changes, so the same links are asked for again
    const restarted = new Router(fake, state);
    await restarted.load();
    expect(restarted.speakers).toEqual([KITCHEN]);
  });

  it('hands back once with no speakers, then leaves PipeWire alone', async () => {
    const fake = new FakePipeWire();
    const router = new Router(fake, state);
    await router.choose([]);
    await router.reconcile();
    expect(fake.applied).toEqual([]); // Chromium already plays to the default output
  });

  it('starts with no speakers from a broken or missing state file', async () => {
    const missing = new Router(new FakePipeWire(), state);
    await missing.load();
    expect(missing.speakers).toEqual([]);
    await mkdir(path.dirname(state), { recursive: true });
    await writeFile(state, '[1, 2]');
    const broken = new Router(new FakePipeWire(), state);
    await broken.load();
    expect(broken.speakers).toEqual([]);
  });

  it('keeps going when the choice cannot be saved', async () => {
    silence('warn');
    await writeFile(path.join(directory, 'file'), '');
    const router = new Router(new FakePipeWire(), path.join(directory, 'file', 'airplay.json'));
    await expect(router.choose([LOUNGE])).resolves.toMatchObject({ selected: [LOUNGE] });
    expect(console.warn).toHaveBeenCalled();
  });
});

describe('validSpeakers', () => {
  it('accepts only a short list of short names', () => {
    expect(validSpeakers(['a'])).toEqual(['a']);
    for (const bad of ['a', [1], [''], ['x'.repeat(300)], Array.from({ length: 17 }, () => 'a'), null]) {
      expect(validSpeakers(bad)).toBeNull();
    }
  });
});

describe('the HTTP API', () => {
  let server: Server;
  let port: number;
  let fake: FakePipeWire;

  beforeEach(async () => {
    silence('info');
    fake = new FakePipeWire();
    server = createServer();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
    const handle = makeHandler(new Router(fake), port, new Set([ORIGIN]));
    server.on('request', (request, response) => {
      void handle(request, response);
    });
  });

  afterEach(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  interface Reply {
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: unknown;
  }

  const send = (method: string, headers: Record<string, string> = {}, body?: string, urlPath = '/v1/airplay') =>
    new Promise<Reply>((resolve, reject) => {
      const request = httpRequest(
        { host: '127.0.0.1', port, method, path: urlPath, headers: { Host: `127.0.0.1:${port}`, ...headers } },
        response => {
          let text = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => (text += chunk));
          response.on('end', () => {
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              body: text ? JSON.parse(text) : null
            });
          });
        }
      );
      request.on('error', reject);
      request.end(body);
    });

  const put = (payload: unknown, headers: Record<string, string> = {}) =>
    send('PUT', { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers }, JSON.stringify(payload));

  it('answers the app', async () => {
    const reply = await send('GET', { Origin: ORIGIN });
    expect(reply.status).toBe(200);
    expect(reply.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect((reply.body as { speakers: unknown[] }).speakers).toHaveLength(2);
  });

  it('answers a program on the Pi, without CORS headers', async () => {
    const reply = await send('GET');
    expect(reply.status).toBe(200);
    expect(reply.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('refuses other origins, hosts, paths and methods', async () => {
    expect((await send('GET', { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await send('GET', { Host: `evil.example:${port}` })).status).toBe(421);
    expect((await send('GET', {}, undefined, '/other')).status).toBe(404);
    expect((await send('DELETE')).status).toBe(405);
  });

  it('allows the private network preflight from the app only', async () => {
    const reply = await send('OPTIONS', {
      Origin: ORIGIN,
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Private-Network': 'true'
    });
    expect(reply.status).toBe(204);
    expect(reply.headers['access-control-allow-private-network']).toBe('true');
    expect(reply.headers['access-control-allow-methods']).toBe('GET, PUT');
    expect((await send('OPTIONS', { Origin: 'https://evil.example' })).status).toBe(403);
  });

  it('routes to the speakers it is sent', async () => {
    const reply = await put({ speakers: [LOUNGE] });
    expect(reply.status).toBe(200);
    expect((reply.body as { selected: string[] }).selected).toEqual([LOUNGE]);
    expect(fake.applied[0]?.connect).toEqual([
      [71, 61],
      [72, 62]
    ]);
  });

  it('checks what it is sent', async () => {
    expect((await put({ speakers: [LOUNGE] }, { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await put({ speakers: 'all' })).status).toBe(400);
    expect((await put(['x'])).status).toBe(400);
    expect((await send('PUT', { 'Content-Type': 'application/json' }, '{')).status).toBe(400);
    expect((await put({ speakers: Array.from({ length: 16 }, () => 'x'.repeat(256)) })).status).toBe(400); // over 4 KB
    expect(fake.applied).toEqual([]);
  });

  it('says when PipeWire is down', async () => {
    silence('warn');
    fake.fail = true;
    const reply = await send('GET', { Origin: ORIGIN });
    expect(reply.status).toBe(503);
    expect(reply.body).toEqual({ error: 'PipeWire is not available' });
  });
});
