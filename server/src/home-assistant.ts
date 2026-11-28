// Home Assistant, as this service talks to it for the lights (lights.ts). The service is signed in as an ordinary Home
// Assistant user through Home Assistant's own login for apps (its auth API): a one-time code is exchanged for a refresh
// token, which is kept in a file only the kiosk user can read and never reaches the app, and each 30-minute access token
// is made from it when needed. Lights are switched over the REST API and followed over the WebSocket API
// (subscribe_entities, which takes the entities to follow; state_changed cannot be filtered by entity).
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { WebSocket } from 'ws';
import type { RawData } from 'ws';

const FETCH_TIMEOUT_MS = 15_000;
/** An access token this close to its end is replaced before it is used. */
const EXPIRY_MARGIN_MS = 60_000;
const MAX_TOKEN = 4096;
const FULL_BRIGHTNESS = 255;
/** How Home Assistant answers a code or a refresh token it does not take (invalid_grant, invalid_request). */
const REFUSALS = new Set([400, 401, 403]);

/** The sign-in this service holds: where Home Assistant is, the client ID it signed in as, and the refresh token. */
export interface Session {
  /** Home Assistant's origin. */
  url: string;
  /** The client ID the code was issued to, which every refresh has to name again. */
  clientId: string;
  refreshToken: string;
}

/** Where the session is kept between starts. */
export interface SessionStore {
  save: (session: Session) => Promise<void>;
  /** The session kept, or null when there is none. */
  read: () => Promise<Session | null>;
  remove: () => Promise<void>;
}

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_TOKEN;

/** The origin of a web address with one of `protocols`, or null when it is not one. */
function originOf(value: unknown, protocols: readonly string[]): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return protocols.includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

/** An https address's origin, or null when it is not one: what goes there never goes over plain HTTP. */
export const httpsOrigin = (value: unknown): string | null => originOf(value, ['https:']);

/**
 * Home Assistant's origin from its address, or null when it is not a web address. Plain http is taken too: many are
 * reached that way at home (homeassistant.local:8123), as Home Assistant's own apps reach them.
 */
export const homeAssistantOrigin = (value: unknown): string | null => originOf(value, ['https:', 'http:']);

function parseSession(value: unknown): Session | null {
  if (typeof value !== 'object' || value === null) return null;
  const { url, clientId, refreshToken } = value as Record<string, unknown>;
  const origin = homeAssistantOrigin(url);
  return origin !== null && isText(clientId) && isText(refreshToken) ? { url: origin, clientId, refreshToken } : null;
}

/** The session kept in `file`, which only the kiosk user can read. */
export function sessionFile(file: string): SessionStore {
  return {
    save: async session => {
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      // Written beside it and moved over it, so a reader never finds half a file.
      await writeFile(`${file}.tmp`, JSON.stringify(session), { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    },
    read: async () => {
      try {
        return parseSession(JSON.parse(await readFile(file, 'utf8')));
      } catch {
        return null;
      }
    },
    remove: async () => {
      await rm(file, { force: true });
    }
  };
}

/**
 * What asking Home Assistant for a token gave: the tokens; `refused` when Home Assistant no longer takes the code or
 * the refresh token (so the sign-in is over); `failed` when it could not be reached or answered something else.
 */
export type TokenResult =
  { accessToken: string; expiresInMs: number; refreshToken: string | null } | { error: 'refused' | 'failed' };

type Fetch = typeof fetch;

async function requestToken(url: string, form: Record<string, string>, fetchIt: Fetch): Promise<TokenResult> {
  try {
    const response = await fetchIt(new URL('/auth/token', url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (REFUSALS.has(response.status)) return { error: 'refused' };
    if (!response.ok) return { error: 'failed' };
    const body = (await response.json()) as Record<string, unknown> | null;
    const accessToken = body?.['access_token'];
    const expiresIn = body?.['expires_in'];
    if (typeof expiresIn !== 'number' || expiresIn <= 0 || !isText(accessToken)) return { error: 'failed' };
    const refreshToken = body?.['refresh_token'];
    return { accessToken, expiresInMs: expiresIn * 1000, refreshToken: isText(refreshToken) ? refreshToken : null };
  } catch {
    return { error: 'failed' };
  }
}

/** Exchanges the one-time code of a finished login for tokens. */
export const exchangeCode = (url: string, clientId: string, code: string, fetchIt: Fetch = fetch) =>
  requestToken(url, { grant_type: 'authorization_code', code, client_id: clientId }, fetchIt);

/** Makes a new access token from the session's refresh token. */
export const refreshAccess = (session: Session, fetchIt: Fetch = fetch) =>
  requestToken(
    session.url,
    { grant_type: 'refresh_token', refresh_token: session.refreshToken, client_id: session.clientId },
    fetchIt
  );

/** A light as the app shows it. */
export interface LightState {
  /** Whether it is on. */
  on: boolean;
  /** Its brightness in percent (1 to 100), or null when it is off or cannot be dimmed. */
  brightness: number | null;
  /** Whether its brightness can be set. */
  dimmable: boolean;
  /** Whether Home Assistant can reach it. */
  available: boolean;
  /** Home Assistant's own name for it, or null when it has none. */
  name: string | null;
}

/** An entity as subscribe_entities sends it: `s` its state and `a` its attributes. */
export interface Entity {
  s: string;
  a: Record<string, unknown>;
}

/** What the app shows for an entity. */
export function lightState(entity: Entity): LightState {
  const { brightness, friendly_name: name, supported_color_modes: modes } = entity.a;
  const isOn = entity.s === 'on';
  return {
    on: isOn,
    brightness:
      isOn && typeof brightness === 'number'
        ? Math.min(100, Math.max(1, Math.round((brightness / FULL_BRIGHTNESS) * 100)))
        : null,
    dimmable: Array.isArray(modes) && modes.some(mode => mode !== 'onoff'),
    available: entity.s !== 'unavailable' && entity.s !== 'unknown',
    name: typeof name === 'string' && name ? name : null
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function addEntities(entities: Map<string, Entity>, added: Record<string, unknown>): void {
  for (const [id, value] of Object.entries(added)) {
    if (!isRecord(value) || typeof value['s'] !== 'string') continue;
    entities.set(id, { s: value['s'], a: isRecord(value['a']) ? { ...value['a'] } : {} });
  }
}

/** One entity as changed: what changed is under `+`, and the names of the attributes it lost under `-`. */
function changedEntity(entity: Entity, change: Record<string, unknown>): Entity {
  const plus = isRecord(change['+']) ? change['+'] : {};
  const minus = isRecord(change['-']) ? change['-'] : {};
  const lost = new Set<unknown>(Array.isArray(minus['a']) ? minus['a'] : []);
  const kept = Object.entries(entity.a).filter(([name]) => !lost.has(name));
  return {
    s: typeof plus['s'] === 'string' ? plus['s'] : entity.s,
    a: { ...Object.fromEntries(kept), ...(isRecord(plus['a']) && plus['a']) }
  };
}

/**
 * Brings `entities` up to date with one subscribe_entities event: `a` adds entities whole, `c` changes the ones it
 * names and `r` names the ones that are gone.
 */
export function applyEntityEvent(entities: Map<string, Entity>, event: unknown): void {
  if (!isRecord(event)) return;
  const { a: added, c: changed, r: removed } = event;
  if (isRecord(added)) addEntities(entities, added);
  if (isRecord(changed)) {
    for (const [id, change] of Object.entries(changed)) {
      const entity = entities.get(id);
      if (entity && isRecord(change)) entities.set(id, changedEntity(entity, change));
    }
  }
  if (Array.isArray(removed)) {
    for (const id of removed as unknown[]) if (typeof id === 'string') entities.delete(id);
  }
}

/** A WebSocket message's text, whichever form `ws` handed it over in. */
function textOf(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return (Buffer.isBuffer(data) ? data : Buffer.from(new Uint8Array(data))).toString('utf8');
}

/** Why following ended: Home Assistant did not take the token, or the connection went away. */
export type FollowEnd = 'auth-invalid' | 'closed';

export interface FollowHandlers {
  /** Home Assistant took the token, and the entities' states follow. */
  onOpen: () => void;
  /** One subscribe_entities event, for applyEntityEvent. */
  onEvent: (event: unknown) => void;
  /** Called once, when the connection is over. */
  onEnd: (why: FollowEnd) => void;
}

export type Connect = (url: string) => WebSocket;
/** Follows entities over Home Assistant's WebSocket API; returns how to stop (after which nothing more is called). */
export type Follow = (url: string, accessToken: string, entityIds: string[], handlers: FollowHandlers) => () => void;

const SUBSCRIPTION_ID = 1;

/** Follows the entities' states until stopped or the connection ends. */
export function followEntities(connect: Connect = url => new WebSocket(url)): Follow {
  return (url, accessToken, entityIds, handlers) => {
    const address = new URL('/api/websocket', url);
    // An http origin becomes ws, an https one wss.
    address.protocol = address.protocol === 'http:' ? 'ws:' : 'wss:';
    const socket = connect(address.href);
    let isOver = false;
    const end = (why: FollowEnd) => {
      if (isOver) return;
      isOver = true;
      handlers.onEnd(why);
    };
    socket.on('message', data => {
      let message: unknown;
      try {
        message = JSON.parse(textOf(data));
      } catch {
        return;
      }
      if (isOver || !isRecord(message)) return;
      switch (message['type']) {
        case 'auth_required': {
          socket.send(JSON.stringify({ type: 'auth', access_token: accessToken }));
          break;
        }
        case 'auth_ok': {
          socket.send(JSON.stringify({ id: SUBSCRIPTION_ID, type: 'subscribe_entities', entity_ids: entityIds }));
          handlers.onOpen();
          break;
        }
        case 'auth_invalid': {
          end('auth-invalid');
          socket.close();
          break;
        }
        case 'event': {
          if (message['id'] === SUBSCRIPTION_ID) handlers.onEvent(message['event']);
          break;
        }
        default:
      }
    });
    socket.on('error', () => {
      // A close follows, which ends it.
    });
    socket.on('close', () => {
      end('closed');
    });
    return () => {
      isOver = true;
      socket.close();
    };
  };
}

/** What switching a light came to: done; `unauthorized` when the token was not taken; `failed` otherwise. */
export type CallResult = 'done' | 'unauthorized' | 'failed';
export type CallService = (
  url: string,
  accessToken: string,
  service: string,
  data: Record<string, unknown>
) => Promise<CallResult>;

/** Calls one of Home Assistant's services (`domain/service`) over its REST API. */
export const callService =
  (fetchIt: Fetch = fetch): CallService =>
  async (url, accessToken, service, data) => {
    try {
      const response = await fetchIt(new URL(`/api/services/${service}`, url), {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        redirect: 'error',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });
      if (response.status === 401) return 'unauthorized';
      return response.ok ? 'done' : 'failed';
    } catch {
      return 'failed';
    }
  };

/** An access token to use now; `refused` when the sign-in is over, `failed` when Home Assistant can't be reached. */
export type Access = { token: string } | { error: 'refused' | 'failed' };

/** A session's access tokens: one is kept until shortly before it ends, and a new one made when asked for after. */
export class AccessTokens {
  readonly #session: Session;
  readonly #refresh: (session: Session) => Promise<TokenResult>;
  readonly #now: () => number;
  #token: string | null = null;
  #expiresAt = 0;
  /** A refresh under way, which everyone asking meanwhile waits for. */
  #refreshing: Promise<Access> | null = null;

  constructor(
    session: Session,
    refresh: (session: Session) => Promise<TokenResult> = refreshAccess,
    now: () => number = Date.now
  ) {
    this.#session = session;
    this.#refresh = refresh;
    this.#now = now;
  }

  async #renew(): Promise<Access> {
    try {
      const result = await this.#refresh(this.#session);
      if ('error' in result) return result;
      this.keep(result.accessToken, result.expiresInMs);
      return { token: result.accessToken };
    } finally {
      this.#refreshing = null;
    }
  }

  /** Takes an access token and how long it lasts; the first one comes with the sign-in. */
  keep(accessToken: string, expiresInMs: number): void {
    this.#token = accessToken;
    this.#expiresAt = this.#now() + expiresInMs;
  }

  /** Forgets the access token held, which Home Assistant did not take. */
  drop(): void {
    this.#token = null;
  }

  /** An access token to use now, from a refresh unless the one held still lasts. */
  async get(): Promise<Access> {
    if (this.#token !== null && this.#now() < this.#expiresAt - EXPIRY_MARGIN_MS) return { token: this.#token };
    this.#refreshing ??= this.#renew();
    return this.#refreshing;
  }
}
