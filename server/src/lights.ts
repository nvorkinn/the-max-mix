// The lights the kiosk may switch, which are Home Assistant's (home-assistant.ts). Which lights is the owner's choice,
// in the kiosk's config on countdown-server (its `lights` section: Home Assistant's address and the entities). The app
// says where that config is (POST /lights/config, with the device secret) and this fetches it itself, so the list of
// lights never comes from the page; anything not on it is refused here, since Home Assistant lets an ordinary user
// switch every entity. This follows the allowed lights while it is signed in, and tells the app of each change (GET
// /lights/events), so its buttons stay right when a light is switched some other way.
import {
  AccessTokens,
  applyEntityEvent,
  exchangeCode,
  httpsOrigin,
  lightState,
  refreshAccess
} from './home-assistant.ts';
import type { CallService, Entity, Follow, LightState, Session, SessionStore, TokenResult } from './home-assistant.ts';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_TEXT = 512;
const MAX_LIGHTS = 32;
const MAX_NAME = 64;
/** How long to wait before connecting to Home Assistant again, at first; doubled each time, up to MAX_RETRY_MS. */
const RETRY_MS = 5000;
const MAX_RETRY_MS = 60_000;
/** A Home Assistant entity ID of a kind that turns on and off. */
const ENTITY_ID = /^(light|switch|group)\.[\d_a-z]+$/;

/** A light the owner allowed, with the name they gave it (null: Home Assistant's own). */
interface AllowedLight {
  id: string;
  name: string | null;
}

/** The config's `lights` section, as this service uses it. */
export interface LightsConfig {
  /** Home Assistant's origin. */
  url: string;
  lights: AllowedLight[];
}

/** The `lights` section of a device config as a LightsConfig, or null when there is none (or it is not one). */
export function parseLightsConfig(section: unknown): LightsConfig | null {
  if (typeof section !== 'object' || section === null) return null;
  const { home_assistant_url: address, entities } = section as Record<string, unknown>;
  const url = httpsOrigin(address);
  if (url === null || !Array.isArray(entities)) return null;
  const lights: AllowedLight[] = [];
  for (const entity of entities.slice(0, MAX_LIGHTS) as unknown[]) {
    if (typeof entity !== 'object' || entity === null) continue;
    const { entity_id: id, name } = entity as Record<string, unknown>;
    if (typeof id !== 'string' || !ENTITY_ID.test(id) || lights.some(light => light.id === id)) continue;
    lights.push({ id, name: typeof name === 'string' && name.trim() ? name.trim().slice(0, MAX_NAME) : null });
  }
  return { url, lights };
}

/** Where the kiosk's config is, and the device secret that reads it. */
export interface ConfigRequest {
  /** countdown-server's API origin. */
  server: string;
  secret: string;
}

/** Printable ASCII without spaces, as a secret is. */
const isToken = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_TEXT && /^[!-~]+$/.test(value);

/** The body of POST /lights/config as a request, or null when it is not one. */
export function validConfigRequest(body: unknown): ConfigRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const { server, secret } = body as Record<string, unknown>;
  const origin = httpsOrigin(server);
  return origin !== null && isToken(secret) ? { server: origin, secret } : null;
}

/** The config's lights; null when the config has none; `failed` when the config could not be read. */
export type FetchConfig = (request: ConfigRequest) => Promise<LightsConfig | null | 'failed'>;

/** Reads the kiosk's config from countdown-server (GET /api/devices/config) for its lights. */
export const fetchLightsConfig: FetchConfig = async ({ server, secret }) => {
  try {
    const response = await fetch(new URL('/api/devices/config', server), {
      headers: { Authorization: `Bearer ${secret}` },
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!response.ok) return 'failed';
    const config = (await response.json()) as { lights?: unknown } | null;
    return parseLightsConfig(config?.lights);
  } catch {
    return 'failed';
  }
};

/** What to do to a light: turn it on or off, or on at a brightness (1 to 100 percent). */
export interface SetRequest {
  id: string;
  on: boolean;
  brightness: number | null;
}

/** The body of POST /lights/set as a request, or null when it is not one. */
export function validSetRequest(body: unknown): SetRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const { id, on, brightness = null } = body as Record<string, unknown>;
  if (typeof on !== 'boolean' || typeof id !== 'string' || !ENTITY_ID.test(id)) return null;
  if (brightness === null) return { id, on, brightness };
  // Only a light has a brightness, and only one that is being turned on.
  if (!on || typeof brightness !== 'number' || !id.startsWith('light.')) return null;
  return Number.isSafeInteger(brightness) && brightness >= 1 && brightness <= 100 ? { id, on, brightness } : null;
}

/** A light as the app shows it. */
interface ShownLight extends Omit<LightState, 'name'> {
  id: string;
  name: string;
}

/**
 * Where the lights stand: `off` when the config has none; `signed-out` when nobody has signed this kiosk in to Home
 * Assistant (or the sign-in ended); `connecting` until Home Assistant has answered; `ready`; `unreachable` when it
 * can't be reached, which is tried again.
 */
export type LightsPhase = 'off' | 'signed-out' | 'connecting' | 'ready' | 'unreachable';

export interface LightsStatus {
  state: LightsPhase;
  /** The allowed lights, in the config's order; none unless there is a config. */
  lights: ShownLight[];
}

/** What switching a light came to. */
export type SetResult = 'done' | 'not-allowed' | 'not-ready' | 'failed';

export interface LightsOptions {
  store: SessionStore;
  follow: Follow;
  call: CallService;
  fetchConfig?: FetchConfig;
  exchange?: (url: string, clientId: string, code: string) => Promise<TokenResult>;
  refresh?: (session: Session) => Promise<TokenResult>;
  retryMs?: number;
}

const UNKNOWN: Entity = { s: 'unavailable', a: {} };

/** The kiosk's lights: the allowed ones, their states while signed in, and switching them. */
export class Lights {
  readonly #options: Required<LightsOptions>;
  readonly #listeners = new Set<(status: LightsStatus) => void>();
  readonly #entities = new Map<string, Entity>();
  #config: LightsConfig | null = null;
  #phase: LightsPhase = 'off';
  #tokens: AccessTokens | null = null;
  #stopFollowing: (() => void) | null = null;
  #retry: ReturnType<typeof setTimeout> | undefined;
  #retryMs: number;
  /** Counts the starts, so what an earlier one was waiting for is dropped when it arrives. */
  #run = 0;

  constructor(options: LightsOptions) {
    this.#options = {
      fetchConfig: fetchLightsConfig,
      exchange: exchangeCode,
      refresh: refreshAccess,
      retryMs: RETRY_MS,
      ...options
    };
    this.#retryMs = this.#options.retryMs;
  }

  #notify(): void {
    const status = this.status();
    for (const listener of this.#listeners) listener(status);
  }

  #enter(phase: LightsPhase): void {
    if (this.#phase === phase) return;
    this.#phase = phase;
    this.#notify();
  }

  /** Ends whatever is under way: the connection, a retry that is waiting, and anything still to arrive. */
  #stop(): void {
    this.#run += 1;
    clearTimeout(this.#retry);
    this.#retry = undefined;
    this.#stopFollowing?.();
    this.#stopFollowing = null;
  }

  /** Home Assistant no longer takes the sign-in: forgets it, so the app asks for a new one. */
  async #endSession(): Promise<void> {
    this.#stop();
    this.#tokens = null;
    this.#entities.clear();
    await this.#options.store.remove();
    this.#enter('signed-out');
  }

  #retryLater(run: number): void {
    this.#retry = setTimeout(() => {
      if (run === this.#run) void this.#connect();
    }, this.#retryMs);
    this.#retryMs = Math.min(this.#retryMs * 2, MAX_RETRY_MS);
  }

  /** Follows the allowed lights with a current access token; tries again later when Home Assistant can't be reached. */
  async #connect(): Promise<void> {
    const config = this.#config;
    const tokens = this.#tokens;
    if (!config || !tokens) return;
    const run = this.#run;
    const access = await tokens.get();
    if (run !== this.#run) return;
    if ('token' in access) {
      this.#follow(config, tokens, access.token);
    } else if (access.error === 'refused') {
      await this.#endSession();
    } else {
      this.#enter('unreachable');
      this.#retryLater(run);
    }
  }

  /** Follows the allowed lights until the connection ends, which is then made again. */
  #follow(config: LightsConfig, tokens: AccessTokens, token: string): void {
    const run = this.#run;
    this.#stopFollowing = this.#options.follow(
      config.url,
      token,
      config.lights.map(light => light.id),
      {
        onOpen: () => {
          this.#retryMs = this.#options.retryMs;
          this.#enter('ready');
        },
        onEvent: event => {
          applyEntityEvent(this.#entities, event);
          this.#notify();
        },
        onEnd: why => {
          if (run !== this.#run) return;
          this.#stopFollowing = null;
          // A token Home Assistant did not take is replaced at the next try; one from an ended sign-in is then refused.
          if (why === 'auth-invalid') tokens.drop();
          this.#enter(this.#phase === 'ready' ? 'connecting' : 'unreachable');
          this.#retryLater(run);
        }
      }
    );
  }

  /** Calls a service with a current access token; `unauthorized` when Home Assistant did not take the token. */
  async #call(
    url: string,
    tokens: AccessTokens,
    service: string,
    data: Record<string, unknown>
  ): Promise<SetResult | 'unauthorized'> {
    const access = await tokens.get();
    if ('token' in access) return this.#options.call(url, access.token, service, data);
    if (access.error === 'failed') return 'failed';
    await this.#endSession();
    return 'not-ready';
  }

  /** Starts over from the config and the saved sign-in. */
  async #start(tokens: AccessTokens | null = null): Promise<void> {
    this.#stop();
    this.#entities.clear();
    this.#retryMs = this.#options.retryMs;
    const config = this.#config;
    if (!config) {
      this.#tokens = null;
      this.#enter('off');
      return;
    }
    const run = this.#run;
    const session = await this.#options.store.read();
    if (run !== this.#run) return;
    // A sign-in to another Home Assistant than the config's is of no use here.
    if (session?.url !== config.url) {
      this.#tokens = null;
      this.#enter('signed-out');
      return;
    }
    this.#tokens = tokens ?? new AccessTokens(session, this.#options.refresh);
    this.#enter('connecting');
    await this.#connect();
  }

  /** Reads the kiosk's config for its lights; a config that can't be read leaves the lights as they were. */
  async configure(request: ConfigRequest): Promise<LightsStatus> {
    const config = await this.#options.fetchConfig(request);
    if (config !== 'failed' && JSON.stringify(config) !== JSON.stringify(this.#config)) {
      this.#config = config;
      await this.#start();
    }
    return this.status();
  }

  /** The allowed lights and where they stand. */
  status(): LightsStatus {
    const lights = (this.#config?.lights ?? []).map(({ id, name }) => {
      const { name: ownName, ...state } = lightState(this.#entities.get(id) ?? UNKNOWN);
      return { id, name: name ?? ownName ?? id, ...state };
    });
    return { state: this.#phase, lights };
  }

  /** Calls `listener` with the status after every change; returns how to stop. */
  add(listener: (status: LightsStatus) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Switches one of the allowed lights. */
  async set({ id, on: isOn, brightness }: SetRequest): Promise<SetResult> {
    const config = this.#config;
    if (!config?.lights.some(light => light.id === id)) return 'not-allowed';
    const tokens = this.#tokens;
    if (!tokens) return 'not-ready';
    const turn = isOn ? 'on' : 'off';
    const service = brightness === null ? `homeassistant/turn_${turn}` : 'light/turn_on';
    const data = { entity_id: id, ...(brightness !== null && { brightness_pct: brightness }) };
    let result = await this.#call(config.url, tokens, service, data);
    if (result === 'unauthorized') {
      // A token Home Assistant did not take is replaced once.
      tokens.drop();
      result = await this.#call(config.url, tokens, service, data);
    }
    return result === 'unauthorized' ? 'failed' : result;
  }

  /**
   * Finishes a sign-in to the config's Home Assistant with the one-time code its login gave to `clientId`, and keeps
   * the sign-in. Answers whether Home Assistant took the code.
   */
  async signIn(code: string, clientId: string): Promise<boolean> {
    const config = this.#config;
    if (!config) return false;
    const result = await this.#options.exchange(config.url, clientId, code);
    if ('error' in result || result.refreshToken === null) return false;
    const session: Session = { url: config.url, clientId, refreshToken: result.refreshToken };
    await this.#options.store.save(session);
    const tokens = new AccessTokens(session, this.#options.refresh);
    tokens.keep(result.accessToken, result.expiresInMs);
    await this.#start(tokens);
    return true;
  }

  /** Forgets the sign-in. Home Assistant keeps it listed until it is removed there, or goes unused for 90 days. */
  async signOut(): Promise<void> {
    if (this.#config) await this.#endSession();
    else await this.#options.store.remove();
  }
}
