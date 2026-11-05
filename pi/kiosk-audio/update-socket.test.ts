// @vitest-environment node
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { attachUpdateSocket } from './update-socket.ts';
import type { Update } from './update-socket.ts';
import type { Send } from './update.ts';

const ORIGIN = 'https://the-max-mix.vercel.app';
const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
});

async function start(update: Update): Promise<string> {
  const server = createServer();
  attachUpdateSocket(server, ORIGIN, update);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Connects and collects what the server sends until it closes; null for no Origin header. */
function listen(url: string, origin: string | null = ORIGIN) {
  return new Promise<{ messages: unknown[]; code: number }>((resolve, reject) => {
    const socket = new WebSocket(url, { ...(origin !== null && { origin }) });
    const messages: unknown[] = [];
    socket.on('message', data => {
      messages.push(JSON.parse((data as Buffer).toString('utf8')));
    });
    socket.on('close', code => {
      resolve({ messages, code });
    });
    socket.on('error', reject);
  });
}

describe('the update WebSocket', () => {
  it('streams what the update sends, then closes', async () => {
    const url = await start((send: Send) => {
      send({ type: 'status', state: 'pulling' });
      send({ type: 'log', line: '2026-11-04T20:00:00+0000 kiosk-pull[1]: TASK [kiosk]' });
      send({ type: 'status', state: 'done', message: 'Nothing needed a restart.' });
      return Promise.resolve();
    });
    const { messages, code } = await listen(`${url}/power/update`);
    expect(messages).toEqual([
      { type: 'status', state: 'pulling' },
      { type: 'log', line: '2026-11-04T20:00:00+0000 kiosk-pull[1]: TASK [kiosk]' },
      { type: 'status', state: 'done', message: 'Nothing needed a restart.' }
    ]);
    expect(code).toBe(1000);
  });

  it('refuses another web page, no origin and another path', async () => {
    let started = 0;
    const url = await start(() => {
      started += 1;
      return Promise.resolve();
    });
    await expect(listen(`${url}/power/update`, 'https://evil.example')).rejects.toThrow('403');
    await expect(listen(`${url}/power/update`, null)).rejects.toThrow('403');
    await expect(listen(`${url}/speakers`)).rejects.toThrow('404');
    expect(started).toBe(0);
  });

  it('aborts the update when the app goes away', async () => {
    const aborted = Promise.withResolvers<undefined>();
    const running = Promise.withResolvers<undefined>();
    const url = await start((_send, signal) => {
      signal.addEventListener('abort', () => {
        aborted.resolve(undefined);
      });
      running.resolve(undefined);
      return new Promise<void>(() => {
        // Never settles: the update runs until the app goes away.
      });
    });
    const socket = new WebSocket(`${url}/power/update`, { origin: ORIGIN });
    socket.on('error', () => {
      // Terminated on purpose below.
    });
    await running.promise;
    socket.terminate();
    await aborted.promise;
    expect(socket.readyState).not.toBe(WebSocket.OPEN);
  });

  it('runs one update at a time, and says so to the next', async () => {
    const release = Promise.withResolvers<undefined>();
    const url = await start(async send => {
      send({ type: 'status', state: 'pulling' });
      await release.promise;
    });
    const first = new WebSocket(`${url}/power/update`, { origin: ORIGIN });
    // Once its first message has come, the first update is under way.
    await new Promise(resolve => first.once('message', resolve));
    const second = await listen(`${url}/power/update`);
    expect(second.messages).toEqual([{ type: 'status', state: 'failed', message: 'An update is already running.' }]);
    release.resolve(undefined);
    await new Promise(resolve => first.once('close', resolve));
  });

  it('reports an update that threw as failed', async () => {
    const url = await start(() => Promise.reject(new Error('journal exploded')));
    const { messages } = await listen(`${url}/power/update`);
    expect(messages).toEqual([{ type: 'status', state: 'failed', message: 'Error: journal exploded' }]);
  });

  it('refuses a connection that did not come in on this machine’s own address, whatever its Origin says', () => {
    const update = vi.fn<Update>();
    const server = createServer();
    attachUpdateSocket(server, ORIGIN, update);
    const written: string[] = [];
    const socket = {
      write: (text: string) => {
        written.push(text);
      },
      destroy: vi.fn()
    };
    const request = {
      url: '/power/update',
      headers: { origin: ORIGIN }, // eslint-disable-next-line sonarjs/no-hardcoded-ip -- the hotspot's address
      socket: { localAddress: '10.42.0.1' }
    };
    server.emit('upgrade', request, socket, Buffer.alloc(0));
    expect(written[0]).toContain('403 Forbidden');
    expect(socket.destroy).toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
