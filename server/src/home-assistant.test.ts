// @vitest-environment node
/* eslint-disable unicorn/prefer-event-target -- A `ws` socket is an EventEmitter, so the stand-in is one. */
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import {
  AccessTokens,
  applyEntityEvent,
  callService,
  exchangeCode,
  followEntities,
  homeAssistantOrigin,
  httpsOrigin,
  lightState,
  refreshAccess,
  sessionFile
} from './home-assistant.ts';
import type { Entity, FollowEnd, Session, TokenResult } from './home-assistant.ts';

const HOME = 'https://home.example';
const SESSION: Session = { url: HOME, clientId: 'https://client.example/', refreshToken: 'refresh-1' };
const folders: string[] = [];

/** A fetch that answers with `status`, and one that reaches nothing. */
const answering =
  (status: number, body: unknown = null): typeof fetch =>
  () =>
    Promise.resolve(Response.json(body, { status }));
const offline: typeof fetch = () => Promise.reject(new TypeError('offline'));
/** The form a fetch sent, by field. */
const formOf = (init: RequestInit | undefined) => Object.fromEntries(new URLSearchParams(init?.body as string));

afterEach(async () => {
  await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true })));
});

describe('homeAssistantOrigin', () => {
  it('is the origin of an http or https address', () => {
    expect(homeAssistantOrigin('https://home.example/lovelace')).toBe('https://home.example');
    // eslint-disable-next-line sonarjs/no-clear-text-protocols -- plain http is what it takes
    expect(homeAssistantOrigin('http://homeassistant.local:8123/')).toBe('http://homeassistant.local:8123');
    expect(homeAssistantOrigin('ftp://home.example')).toBeNull();
    expect(homeAssistantOrigin('homeassistant.local')).toBeNull();
  });
});

describe('httpsOrigin', () => {
  it('is the origin of an https address only', () => {
    expect(httpsOrigin('https://home.example:8123/lovelace')).toBe('https://home.example:8123');
    expect(httpsOrigin('http://home.example')).toBeNull();
    expect(httpsOrigin('home.example')).toBeNull();
    expect(httpsOrigin(7)).toBeNull();
  });
});

describe('sessionFile', () => {
  it('keeps the session in a file only its owner can read, and forgets it', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'lights-'));
    folders.push(folder);
    const file = path.join(folder, 'state', 'home-assistant.json');
    const store = sessionFile(file);
    expect(await store.read()).toBeNull();
    await store.save(SESSION);
    expect(await store.read()).toEqual(SESSION);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    await store.remove();
    expect(await store.read()).toBeNull();
  });

  it('reads nothing from a file that is not a session', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'lights-'));
    folders.push(folder);
    const file = path.join(folder, 'home-assistant.json');
    await writeFile(file, JSON.stringify({ ...SESSION, refreshToken: '' }));
    expect(await sessionFile(file).read()).toBeNull();
    expect(await readFile(file, 'utf8')).toContain('refresh');
  });
});

describe('the tokens', () => {
  const answer = { access_token: 'access-1', expires_in: 1800, refresh_token: 'refresh-1', token_type: 'Bearer' };

  it('exchanges a code for tokens, as a form', async () => {
    const fetched = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(answer)));
    expect(await exchangeCode(HOME, 'https://client.example/', 'code-1', fetched)).toEqual({
      accessToken: 'access-1',
      expiresInMs: 1_800_000,
      refreshToken: 'refresh-1'
    });
    const [url, init] = fetched.mock.calls[0] ?? [];
    expect((url as URL).href).toBe('https://home.example/auth/token');
    expect(init?.method).toBe('POST');
    expect(formOf(init)).toEqual({
      grant_type: 'authorization_code',
      code: 'code-1',
      client_id: 'https://client.example/'
    });
  });

  it('refreshes with the refresh token and the client ID', async () => {
    const fetched = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ access_token: 'access-2', expires_in: 1800, token_type: 'Bearer' }))
    );
    expect(await refreshAccess(SESSION, fetched)).toEqual({
      accessToken: 'access-2',
      expiresInMs: 1_800_000,
      refreshToken: null
    });
    expect(formOf(fetched.mock.calls[0]?.[1])).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'refresh-1',
      client_id: 'https://client.example/'
    });
  });

  it('tells a refusal from a failure', async () => {
    expect(await refreshAccess(SESSION, answering(400, { error: 'invalid_grant' }))).toEqual({ error: 'refused' });
    expect(await refreshAccess(SESSION, answering(502))).toEqual({ error: 'failed' });
    expect(await refreshAccess(SESSION, offline)).toEqual({ error: 'failed' });
    expect(await refreshAccess(SESSION, answering(200, { access_token: 'access-1' }))).toEqual({ error: 'failed' });
  });
});

describe('AccessTokens', () => {
  it('keeps a token until shortly before it ends, and refreshes once for everyone asking', async () => {
    let now = 0;
    let made = 0;
    const refresh = vi.fn((): Promise<TokenResult> => {
      made += 1;
      return Promise.resolve({ accessToken: `access-${made}`, expiresInMs: 1_800_000, refreshToken: null });
    });
    const tokens = new AccessTokens(SESSION, refresh, () => now);
    expect(await Promise.all([tokens.get(), tokens.get()])).toEqual([{ token: 'access-1' }, { token: 'access-1' }]);
    expect(refresh).toHaveBeenCalledTimes(1);
    now = 1_700_000;
    expect(await tokens.get()).toEqual({ token: 'access-1' });
    now = 1_750_000;
    expect(await tokens.get()).toEqual({ token: 'access-2' });
    tokens.drop();
    expect(await tokens.get()).toEqual({ token: 'access-3' });
  });

  it('starts with the token of the sign-in, and passes on why there is none', async () => {
    const refresh = vi.fn((): Promise<TokenResult> => Promise.resolve({ error: 'refused' }));
    const tokens = new AccessTokens(SESSION, refresh, () => 0);
    tokens.keep('access-0', 1_800_000);
    expect(await tokens.get()).toEqual({ token: 'access-0' });
    tokens.drop();
    expect(await tokens.get()).toEqual({ error: 'refused' });
  });
});

describe('lightState', () => {
  it('reads on, the brightness in percent and whether it dims', () => {
    const entity: Entity = {
      s: 'on',
      a: { brightness: 255, friendly_name: 'Kitchen', supported_color_modes: ['color_temp', 'xy'] }
    };
    expect(lightState(entity)).toEqual({ on: true, brightness: 100, dimmable: true, available: true, name: 'Kitchen' });
    expect(lightState({ s: 'on', a: { brightness: 1 } }).brightness).toBe(1);
  });

  it('has no brightness when off or not dimmable, and says when it cannot be reached', () => {
    expect(lightState({ s: 'off', a: { brightness: null, supported_color_modes: ['onoff'] } })).toEqual({
      on: false,
      brightness: null,
      dimmable: false,
      available: true,
      name: null
    });
    expect(lightState({ s: 'unavailable', a: {} }).available).toBe(false);
  });
});

describe('applyEntityEvent', () => {
  it('adds, changes and removes entities', () => {
    const entities = new Map<string, Entity>();
    applyEntityEvent(entities, { a: { 'light.kitchen': { s: 'on', a: { brightness: 128, effect: 'none' } } } });
    expect(entities.get('light.kitchen')).toEqual({ s: 'on', a: { brightness: 128, effect: 'none' } });
    const change = { 'light.kitchen': { '+': { s: 'off', a: { brightness: null } }, '-': { a: ['effect'] } } };
    applyEntityEvent(entities, { c: change });
    expect(entities.get('light.kitchen')).toEqual({ s: 'off', a: { brightness: null } });
    applyEntityEvent(entities, { c: { 'light.kitchen': { '+': { a: { brightness: 3 } } } } });
    expect(entities.get('light.kitchen')).toEqual({ s: 'off', a: { brightness: 3 } });
    applyEntityEvent(entities, { r: ['light.kitchen'] });
    expect(entities.size).toBe(0);
  });

  it('changes nothing for what is not an event, or names an entity it does not have', () => {
    const entities = new Map<string, Entity>();
    applyEntityEvent(entities, null);
    applyEntityEvent(entities, { c: { 'light.hall': { '+': { s: 'on' } } } });
    applyEntityEvent(entities, { a: { 'light.hall': { a: {} } }, r: ['light.hall', 7] });
    expect(entities.size).toBe(0);
  });
});

/** Stands in for the `ws` socket to Home Assistant. */
class FakeSocket extends EventEmitter {
  readonly sent: unknown[] = [];
  isClosed = false;
  send(text: string): void {
    this.sent.push(JSON.parse(text));
  }
  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.emit('close');
  }
  say(message: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(message)));
  }
}

function following() {
  const socket = new FakeSocket();
  const urls: string[] = [];
  const events: unknown[] = [];
  const ends: FollowEnd[] = [];
  let opens = 0;
  const follow = followEntities(url => {
    urls.push(url);
    return socket as unknown as WebSocket;
  });
  const stop = follow(HOME, 'access-1', ['light.kitchen'], {
    onOpen: () => {
      opens += 1;
    },
    onEvent: event => {
      events.push(event);
    },
    onEnd: why => {
      ends.push(why);
    }
  });
  return { socket, urls, events, ends, stop, opens: () => opens };
}

describe('followEntities', () => {
  it('signs in, subscribes to the entities and hands on their events', () => {
    const { socket, urls, events, opens } = following();
    expect(urls).toEqual(['wss://home.example/api/websocket']);
    socket.say({ type: 'auth_required' });
    expect(socket.sent).toEqual([{ type: 'auth', access_token: 'access-1' }]);
    socket.say({ type: 'auth_ok' });
    expect(socket.sent[1]).toEqual({ id: 1, type: 'subscribe_entities', entity_ids: ['light.kitchen'] });
    expect(opens()).toBe(1);
    socket.say({ id: 1, type: 'result', success: true });
    socket.say({ id: 1, type: 'event', event: { a: {} } });
    socket.say({ id: 2, type: 'event', event: { a: { other: true } } });
    socket.emit('message', Buffer.from('not json'));
    expect(events).toEqual([{ a: {} }]);
  });

  it('follows a plain-http Home Assistant over ws', () => {
    const urls: string[] = [];
    const follow = followEntities(url => {
      urls.push(url);
      return new FakeSocket() as unknown as WebSocket;
    });
    const quiet = { onOpen: vi.fn(), onEvent: vi.fn(), onEnd: vi.fn() };
    // eslint-disable-next-line sonarjs/no-clear-text-protocols -- plain http is what it takes
    follow('http://homeassistant.local:8123', 'access-1', [], quiet);
    // eslint-disable-next-line sonarjs/no-clear-text-protocols -- plain ws is what it then uses
    expect(urls).toEqual(['ws://homeassistant.local:8123/api/websocket']);
  });

  it('ends once: when the token is not taken, or when the connection goes', () => {
    const refused = following();
    refused.socket.say({ type: 'auth_invalid', message: 'Invalid access token' });
    expect(refused.ends).toEqual(['auth-invalid']);
    expect(refused.socket.isClosed).toBe(true);
    const dropped = following();
    dropped.socket.emit('error', new Error('reset'));
    dropped.socket.emit('close');
    expect(dropped.ends).toEqual(['closed']);
  });

  it('says nothing more once stopped', () => {
    const { socket, stop, events, ends } = following();
    stop();
    socket.say({ id: 1, type: 'event', event: { a: {} } });
    expect(socket.isClosed).toBe(true);
    expect(events).toEqual([]);
    expect(ends).toEqual([]);
  });
});

describe('callService', () => {
  it('posts the service with the token, and reads the answer', async () => {
    const fetched = vi.fn<typeof fetch>(() => Promise.resolve(Response.json([])));
    const data = { entity_id: 'light.kitchen', brightness_pct: 60 };
    expect(await callService(fetched)(HOME, 'access-1', 'light/turn_on', data)).toBe('done');
    const [url, init] = fetched.mock.calls[0] ?? [];
    expect((url as URL).href).toBe('https://home.example/api/services/light/turn_on');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer access-1');
    expect(JSON.parse(init?.body as string)).toEqual(data);
    expect(await callService(answering(401))(HOME, 'access-1', 'light/turn_on', data)).toBe('unauthorized');
    expect(await callService(answering(500))(HOME, 'access-1', 'light/turn_on', data)).toBe('failed');
    expect(await callService(offline)(HOME, 'access-1', 'light/turn_on', data)).toBe('failed');
  });
});
