// @vitest-environment node
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { dump } from './fixtures.ts';
import { parseDump } from './pipewire.ts';
import { handleRequest, speakerNames } from './server.ts';

const ORIGIN = 'https://the-max-mix.vercel.app';
const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function start(graph: () => Promise<ReturnType<typeof parseDump>>): Promise<string> {
  const handler = handleRequest(ORIGIN, graph);
  const server = createServer((request, response) => void handler(request, response));
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('speakerNames', () => {
  it('lists the AirPlay sinks only, sorted', () => {
    const graph = parseDump(dump());
    expect(speakerNames(graph)).toEqual(['Kitchen', 'Lounge']);
  });
});

describe('the speakers endpoint', () => {
  it('answers the app with the speakers', async () => {
    const base = await start(() => Promise.resolve(parseDump(dump())));
    const response = await fetch(`${base}/speakers`);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    await expect(response.json()).resolves.toEqual({ speakers: ['Kitchen', 'Lounge'] });
  });

  it('answers the preflight, and nothing else', async () => {
    const base = await start(() => Promise.resolve(parseDump(dump())));
    const preflight = await fetch(`${base}/speakers`, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-private-network')).toBe('true');
    const other = await fetch(`${base}/other`);
    const post = await fetch(`${base}/speakers`, { method: 'POST' });
    expect([other.status, post.status]).toEqual([404, 404]);
  });

  it('says when PipeWire cannot be read', async () => {
    const base = await start(() => Promise.reject(new Error('no PipeWire')));
    const response = await fetch(`${base}/speakers`);
    expect(response.status).toBe(503);
  });
});
