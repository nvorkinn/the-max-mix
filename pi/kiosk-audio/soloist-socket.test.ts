// @vitest-environment node
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { SOLOIST_PATH, SoloistBridge, soloistCommand } from './soloist-socket.ts';
import { attachUpdateSocket } from './update-socket.ts';

const ORIGIN = 'https://the-max-mix.vorkinn.org';
const closers: (() => void)[] = [];
afterEach(() => {
  for (const close of closers.splice(0).reverse()) close();
});

/** Stands in for Soloist's WebSocket API: greets each client with its auth state and records the commands. */
async function fakeSoloist(port = 0) {
  const server = new WebSocketServer({ port, host: '127.0.0.1' });
  const commands: unknown[] = [];
  server.on('connection', client => {
    client.send(JSON.stringify({ type: 'auth_state', logged_in: true, is_active: false, device_name: 'Probe' }));
    client.on('message', data => {
      commands.push(JSON.parse(String(data)));
      client.send(JSON.stringify({ type: 'command_result', command: 'pause' }));
    });
  });
  await new Promise(resolve => server.once('listening', resolve));
  const stop = () =>
    new Promise<void>(resolve => {
      for (const client of server.clients) client.terminate();
      server.close(() => resolve());
    });
  closers.push(() => void stop());
  return { url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`, commands, stop, server };
}

async function service(soloistUrl: string): Promise<string> {
  const server: Server = createServer();
  const bridge = new SoloistBridge({ url: soloistUrl, retryMs: 20 });
  attachUpdateSocket(server, ORIGIN, () => Promise.resolve(), { [SOLOIST_PATH]: connection => bridge.add(connection) });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  closers.push(() => {
    server.closeAllConnections();
    server.close();
  });
  return `ws://127.0.0.1:${(server.address() as AddressInfo).port}${SOLOIST_PATH}`;
}

/** An app connection that collects what it is sent; `next(n)` waits until it has n messages. */
function app(url: string, origin = ORIGIN) {
  const socket = new WebSocket(url, { origin });
  const messages: Record<string, unknown>[] = [];
  const waiters: (() => void)[] = [];
  socket.on('message', data => {
    messages.push(JSON.parse(String(data)) as Record<string, unknown>);
    for (const wake of waiters.splice(0)) wake();
  });
  closers.push(() => {
    socket.terminate();
  });
  const until = (done: () => boolean) =>
    new Promise<void>(resolve => {
      const check = () => {
        if (done()) resolve();
        else waiters.push(check);
      };
      check();
    });
  return { socket, messages, until };
}

describe('soloistCommand', () => {
  it("passes on Soloist's commands and nothing else", () => {
    expect(soloistCommand('{"type":"command","command":"seek","position_ms":30000}')).toBe(
      '{"type":"command","command":"seek","position_ms":30000}'
    );
    expect(soloistCommand('{"type":"command","command":"shutdown"}')).toBeNull();
    expect(soloistCommand('{"type":"event","command":"pause"}')).toBeNull();
    expect(soloistCommand('["command"]')).toBeNull();
    expect(soloistCommand('not json')).toBeNull();
  });
});

describe('the Soloist WebSocket', () => {
  it("passes Soloist's events to the app, and the app's commands to Soloist", async () => {
    const soloist = await fakeSoloist();
    const client = app(await service(soloist.url));
    await client.until(() => client.messages.some(message => message['type'] === 'auth_state'));
    expect(client.messages).toContainEqual({ type: 'bridge', connected: true });

    client.socket.send(JSON.stringify({ type: 'command', command: 'pause' }));
    await client.until(() => client.messages.some(message => message['type'] === 'command_result'));
    expect(soloist.commands).toEqual([{ type: 'command', command: 'pause' }]);
  });

  it('refuses what is not a command, without passing it on', async () => {
    const soloist = await fakeSoloist();
    const client = app(await service(soloist.url));
    await client.until(() => client.messages.some(message => message['type'] === 'auth_state'));
    client.socket.send(JSON.stringify({ type: 'command', command: 'shutdown' }));
    await client.until(() => client.messages.some(message => message['type'] === 'error'));
    expect(soloist.commands).toEqual([]);
  });

  it('says when Soloist is gone, and connects again once it is back', async () => {
    const soloist = await fakeSoloist();
    const { port } = new URL(soloist.url);
    const client = app(await service(soloist.url));
    await client.until(() => client.messages.some(message => message['type'] === 'auth_state'));

    await soloist.stop();
    await client.until(() => client.messages.some(message => message['type'] === 'bridge' && !message['connected']));
    client.socket.send(JSON.stringify({ type: 'command', command: 'pause' }));
    await client.until(() => client.messages.some(message => message['message'] === 'Soloist is not running'));

    client.messages.length = 0;
    await fakeSoloist(Number(port));
    await client.until(() => client.messages.some(message => message['type'] === 'auth_state'));
    expect(client.messages).toContainEqual({ type: 'bridge', connected: true });
  });

  it('refuses another web page', async () => {
    const soloist = await fakeSoloist();
    const url = await service(soloist.url);
    const refused = new Promise<string>(resolve => {
      const socket = new WebSocket(url, { origin: 'https://evil.example' });
      socket.on('error', error => {
        resolve(String(error));
      });
    });
    await expect(refused).resolves.toContain('403');
  });
});
