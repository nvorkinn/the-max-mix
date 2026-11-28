// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CallResult, Follow, FollowHandlers, Session, SessionStore, TokenResult } from './home-assistant.ts';
import { fetchLightsConfig, Lights, parseLightsConfig, validConfigRequest, validSetRequest } from './lights.ts';
import type { ConfigRequest, LightsConfig, LightsStatus } from './lights.ts';

const HOME = 'https://home.example';
const REQUEST: ConfigRequest = { server: 'https://countdown.run', secret: 'device-secret' };
const CONFIG: LightsConfig = {
  url: HOME,
  lights: [
    { id: 'light.kitchen', name: 'Worktop' },
    { id: 'switch.kettle', name: null }
  ]
};
const SESSION: Session = { url: HOME, clientId: 'https://client.example/', refreshToken: 'refresh-1' };
const KITCHEN_ON = {
  a: {
    'light.kitchen': {
      s: 'on',
      a: { brightness: 128, friendly_name: 'Kitchen', supported_color_modes: ['brightness'] }
    }
  }
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

interface Following {
  url: string;
  token: string;
  ids: string[];
  handlers: FollowHandlers;
  isStopped: boolean;
}

/** The next answer of a list, whose last one is given again after. */
const nextOf = <T>(answers: T[], fallback: T): T => (answers.length > 1 ? answers.shift() : answers[0]) ?? fallback;

/** Lights with a fake Home Assistant: `tokens` are what each refresh answers, in turn (the last one again after). */
function lights(options: { session?: Session | null; tokens?: TokenResult[]; calls?: CallResult[] } = {}) {
  let session = options.session === undefined ? SESSION : options.session;
  const tokens = options.tokens ?? [{ accessToken: 'access-1', expiresInMs: 1_800_000, refreshToken: null }];
  const results = options.calls ?? ['done'];
  const followings: Following[] = [];
  const called: [string, string, Record<string, unknown>][] = [];
  const store: SessionStore = {
    save: kept => {
      session = kept;
      return Promise.resolve();
    },
    read: () => Promise.resolve(session),
    remove: () => {
      session = null;
      return Promise.resolve();
    }
  };
  const follow: Follow = (url, token, ids, handlers) => {
    const following: Following = { url, token, ids, handlers, isStopped: false };
    followings.push(following);
    return () => {
      following.isStopped = true;
    };
  };
  let config: LightsConfig | null | 'failed' = CONFIG;
  const refresh = vi.fn(() => Promise.resolve(nextOf(tokens, { error: 'failed' })));
  const exchange = vi.fn<(url: string, clientId: string, code: string) => Promise<TokenResult>>(() =>
    Promise.resolve({ accessToken: 'access-new', expiresInMs: 1_800_000, refreshToken: 'refresh-new' })
  );
  const subject = new Lights({
    store,
    follow,
    call: (_url, token, service, data) => {
      called.push([token, service, data]);
      return Promise.resolve(nextOf(results, 'failed'));
    },
    fetchConfig: () => Promise.resolve(config),
    exchange,
    refresh,
    retryMs: 1000
  });
  const statuses: LightsStatus[] = [];
  subject.add(status => {
    statuses.push(status);
  });
  return {
    subject,
    followings,
    called,
    statuses,
    refresh,
    exchange,
    session: () => session,
    setConfig: (next: LightsConfig | null | 'failed') => {
      config = next;
    }
  };
}

describe('parseLightsConfig', () => {
  it('takes the address and the entities, with their names', () => {
    const section = {
      home_assistant_url: 'https://home.example/lovelace',
      entities: [{ entity_id: 'light.kitchen', name: ' Worktop ' }, { entity_id: 'switch.kettle' }]
    };
    expect(parseLightsConfig(section)).toEqual(CONFIG);
  });

  it('drops what is not a light, a switch or a group, and anything listed twice', () => {
    const entities = [
      { entity_id: 'lock.front_door' },
      { entity_id: 'light.kitchen' },
      { entity_id: 'light.kitchen', name: 'Again' },
      { entity_id: 'Light.Hall' },
      'light.hall',
      null
    ];
    expect(parseLightsConfig({ home_assistant_url: HOME, entities })?.lights).toEqual([
      { id: 'light.kitchen', name: null }
    ]);
  });

  it('is nothing without an https address or a list', () => {
    expect(parseLightsConfig(null)).toBeNull();
    expect(parseLightsConfig({ entities: [] })).toBeNull();
    expect(parseLightsConfig({ home_assistant_url: 'http://home.example', entities: [] })).toBeNull();
    expect(parseLightsConfig({ home_assistant_url: HOME })).toBeNull();
  });
});

describe('the requests', () => {
  it('takes a server and a secret for the config', () => {
    expect(validConfigRequest({ server: 'https://countdown.run/api', secret: 'device-secret' })).toEqual(REQUEST);
    expect(validConfigRequest({ server: 'countdown.run', secret: 'device-secret' })).toBeNull();
    expect(validConfigRequest({ server: 'https://countdown.run', secret: 'two words' })).toBeNull();
    expect(validConfigRequest(null)).toBeNull();
  });

  it('takes on, off and a brightness for a light', () => {
    expect(validSetRequest({ id: 'light.kitchen', on: false })).toEqual({
      id: 'light.kitchen',
      on: false,
      brightness: null
    });
    expect(validSetRequest({ id: 'light.kitchen', on: true, brightness: 100 })).toEqual({
      id: 'light.kitchen',
      on: true,
      brightness: 100
    });
    expect(validSetRequest({ id: 'light.kitchen', on: true, brightness: 0 })).toBeNull();
    expect(validSetRequest({ id: 'light.kitchen', on: false, brightness: 50 })).toBeNull();
    expect(validSetRequest({ id: 'switch.kettle', on: true, brightness: 50 })).toBeNull();
    expect(validSetRequest({ id: 'light.kitchen', on: 'yes' })).toBeNull();
    expect(validSetRequest({ id: 'cover.garage', on: true })).toBeNull();
  });
});

describe('fetchLightsConfig', () => {
  it('reads the lights from the device config, with the secret', async () => {
    const section = { home_assistant_url: HOME, entities: [{ entity_id: 'light.kitchen', name: 'Worktop' }] };
    const fetched = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ type: 'touchscreen', lights: section })));
    vi.stubGlobal('fetch', fetched);
    expect(await fetchLightsConfig(REQUEST)).toEqual({ url: HOME, lights: [{ id: 'light.kitchen', name: 'Worktop' }] });
    const [url, init] = fetched.mock.calls[0] ?? [];
    expect((url as URL).href).toBe('https://countdown.run/api/devices/config');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer device-secret');
  });

  it('is null for a config without lights, and failed when the config cannot be read', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ type: 'touchscreen' })));
    expect(await fetchLightsConfig(REQUEST)).toBeNull();
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 401 })));
    expect(await fetchLightsConfig(REQUEST)).toBe('failed');
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
    expect(await fetchLightsConfig(REQUEST)).toBe('failed');
  });
});

describe('Lights', () => {
  it('is off until a config has lights, and signed out without a sign-in', async () => {
    const { subject, setConfig, followings } = lights({ session: null });
    expect(subject.status()).toEqual({ state: 'off', lights: [] });
    setConfig(null);
    expect((await subject.configure(REQUEST)).state).toBe('off');
    setConfig(CONFIG);
    const status = await subject.configure(REQUEST);
    expect(status.state).toBe('signed-out');
    expect(status.lights.map(light => light.id)).toEqual(['light.kitchen', 'switch.kettle']);
    expect(followings).toEqual([]);
  });

  it('does not use a sign-in to another Home Assistant', async () => {
    const { subject, followings } = lights({ session: { ...SESSION, url: 'https://other.example' } });
    expect((await subject.configure(REQUEST)).state).toBe('signed-out');
    expect(followings).toEqual([]);
  });

  it('follows the allowed lights, and shows them under the names the config gives', async () => {
    const { subject, followings, statuses } = lights();
    expect((await subject.configure(REQUEST)).state).toBe('connecting');
    expect(followings).toHaveLength(1);
    expect(followings[0]).toMatchObject({ url: HOME, token: 'access-1', ids: ['light.kitchen', 'switch.kettle'] });
    followings[0]?.handlers.onOpen();
    followings[0]?.handlers.onEvent(KITCHEN_ON);
    expect(subject.status()).toEqual({
      state: 'ready',
      lights: [
        { id: 'light.kitchen', name: 'Worktop', on: true, brightness: 50, dimmable: true, available: true },
        { id: 'switch.kettle', name: 'switch.kettle', on: false, brightness: null, dimmable: false, available: false }
      ]
    });
    followings[0]?.handlers.onEvent({ c: { 'light.kitchen': { '+': { s: 'off' } } } });
    expect(statuses.at(-1)?.lights[0]).toMatchObject({ on: false, brightness: null });
  });

  it('keeps the lights as they were when the config cannot be read, and starts over when it changes', async () => {
    const { subject, followings, setConfig } = lights();
    await subject.configure(REQUEST);
    setConfig('failed');
    await subject.configure(REQUEST);
    await subject.configure(REQUEST);
    expect(followings).toHaveLength(1);
    setConfig({ url: HOME, lights: [{ id: 'light.hall', name: null }] });
    await subject.configure(REQUEST);
    expect(followings[0]?.isStopped).toBe(true);
    expect(followings[1]?.ids).toEqual(['light.hall']);
    setConfig(null);
    expect(await subject.configure(REQUEST)).toEqual({ state: 'off', lights: [] });
    expect(followings[1]?.isStopped).toBe(true);
  });

  it('connects again after the connection ends, with a new token when the old one was not taken', async () => {
    vi.useFakeTimers();
    const { subject, followings, refresh } = lights({
      tokens: [
        { accessToken: 'access-1', expiresInMs: 1_800_000, refreshToken: null },
        { accessToken: 'access-2', expiresInMs: 1_800_000, refreshToken: null }
      ]
    });
    await subject.configure(REQUEST);
    followings[0]?.handlers.onOpen();
    followings[0]?.handlers.onEnd('closed');
    expect(subject.status().state).toBe('connecting');
    await vi.advanceTimersByTimeAsync(1000);
    expect(followings[1]?.token).toBe('access-1');
    expect(refresh).toHaveBeenCalledTimes(1);
    followings[1]?.handlers.onEnd('auth-invalid');
    expect(subject.status().state).toBe('unreachable');
    await vi.advanceTimersByTimeAsync(2000);
    expect(followings[2]?.token).toBe('access-2');
  });

  it('tries again later while Home Assistant cannot be reached', async () => {
    vi.useFakeTimers();
    const { subject, followings } = lights({
      tokens: [{ error: 'failed' }, { accessToken: 'access-1', expiresInMs: 1_800_000, refreshToken: null }]
    });
    expect((await subject.configure(REQUEST)).state).toBe('unreachable');
    expect(followings).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(followings).toHaveLength(1);
  });

  it('forgets a sign-in Home Assistant no longer takes', async () => {
    const { subject, followings, session } = lights({ tokens: [{ error: 'refused' }] });
    expect((await subject.configure(REQUEST)).state).toBe('signed-out');
    expect(session()).toBeNull();
    expect(followings).toEqual([]);
    expect(await subject.set({ id: 'light.kitchen', on: true, brightness: null })).toBe('not-ready');
  });

  it('switches only the allowed lights', async () => {
    const { subject, called } = lights();
    await subject.configure(REQUEST);
    expect(await subject.set({ id: 'light.kitchen', on: true, brightness: 60 })).toBe('done');
    expect(await subject.set({ id: 'switch.kettle', on: false, brightness: null })).toBe('done');
    expect(await subject.set({ id: 'light.bedroom', on: true, brightness: null })).toBe('not-allowed');
    expect(called).toEqual([
      ['access-1', 'light/turn_on', { entity_id: 'light.kitchen', brightness_pct: 60 }],
      ['access-1', 'homeassistant/turn_off', { entity_id: 'switch.kettle' }]
    ]);
  });

  it('replaces a token Home Assistant did not take, once', async () => {
    const tokens: TokenResult[] = [
      { accessToken: 'access-1', expiresInMs: 1_800_000, refreshToken: null },
      { accessToken: 'access-2', expiresInMs: 1_800_000, refreshToken: null }
    ];
    const retried = lights({ tokens, calls: ['unauthorized', 'done'] });
    await retried.subject.configure(REQUEST);
    expect(await retried.subject.set({ id: 'light.kitchen', on: true, brightness: null })).toBe('done');
    expect(retried.called.map(([token]) => token)).toEqual(['access-1', 'access-2']);
    const refused = lights({ calls: ['unauthorized'] });
    await refused.subject.configure(REQUEST);
    expect(await refused.subject.set({ id: 'light.kitchen', on: true, brightness: null })).toBe('failed');
    expect(refused.called).toHaveLength(2);
  });

  it('signs in with a code, keeps the sign-in and follows the lights with the first token', async () => {
    const { subject, followings, exchange, session, refresh } = lights({ session: null });
    expect(await subject.signIn('code-1', 'https://client.example/')).toBe(false);
    await subject.configure(REQUEST);
    expect(await subject.signIn('code-1', 'https://client.example/')).toBe(true);
    expect(exchange).toHaveBeenCalledWith(HOME, 'https://client.example/', 'code-1');
    expect(session()).toEqual({ url: HOME, clientId: 'https://client.example/', refreshToken: 'refresh-new' });
    expect(followings[0]?.token).toBe('access-new');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('stays signed out when Home Assistant does not take the code', async () => {
    const { subject, exchange, session } = lights({ session: null });
    await subject.configure(REQUEST);
    exchange.mockResolvedValueOnce({ error: 'refused' });
    expect(await subject.signIn('code-1', 'https://client.example/')).toBe(false);
    expect(session()).toBeNull();
    expect(subject.status().state).toBe('signed-out');
  });

  it('signs out', async () => {
    const { subject, followings, session } = lights();
    await subject.configure(REQUEST);
    await subject.signOut();
    expect(session()).toBeNull();
    expect(followings[0]?.isStopped).toBe(true);
    expect(subject.status().state).toBe('signed-out');
  });
});
