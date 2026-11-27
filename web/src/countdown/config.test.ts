import type { TouchscreenConfig } from 'countdown-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json';
import { cachedDeviceConfig, forgetDeviceConfig, loadDeviceConfig, saveConfigSection } from './config';
import * as registration from './registration';

const SECRET = fixture.registration.secret;

function register() {
  vi.spyOn(registration, 'deviceCredentials').mockReturnValue({ deviceId: fixture.device_id, secret: SECRET });
}

function answer(status: number, body?: unknown) {
  const fetch = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
      })
    )
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

beforeEach(() => {
  forgetDeviceConfig();
  localStorage.clear();
  vi.stubEnv('VITE_COUNTDOWN_API', 'https://countdown.build');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('loadDeviceConfig', () => {
  it('asks nothing of the server before the kiosk is registered', async () => {
    const fetch = answer(200, fixture.config);
    await expect(loadDeviceConfig()).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('gets the config with the device secret, and keeps it', async () => {
    register();
    const fetch = answer(200, fixture.config);
    await expect(loadDeviceConfig()).resolves.toEqual(fixture.config);
    const [input, init] = fetch.mock.calls[0] ?? [''];
    const request = new Request(input, init);
    expect(request.url).toBe('https://countdown.build/api/devices/config');
    expect(request.method).toBe('GET');
    expect(request.headers.get('Authorization')).toBe(`Bearer ${SECRET}`);
    expect(cachedDeviceConfig()).toEqual(fixture.config);
  });

  it('falls back to the last config when the server refuses or cannot be reached', async () => {
    register();
    answer(200, fixture.config);
    await loadDeviceConfig();

    answer(401);
    await expect(loadDeviceConfig()).resolves.toEqual(fixture.config);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    );
    await expect(loadDeviceConfig()).resolves.toEqual(fixture.config);
  });

  it("takes no e-paper screen's config", async () => {
    register();
    answer(200, { ...fixture.config, type: 'epaper' });
    await expect(loadDeviceConfig()).resolves.toBeNull();
    expect(cachedDeviceConfig()).toBeNull();
  });

  it("gives countdown-api's example config in a build that mocks the server", async () => {
    vi.stubEnv('VITE_COUNTDOWN_CONFIG', 'mock');
    const fetch = answer(500);
    await expect(loadDeviceConfig()).resolves.toEqual(fixture.config);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ignores a kept config it cannot read', async () => {
    localStorage.setItem('maxmix.deviceConfig', '{');
    await expect(loadDeviceConfig()).resolves.toBeNull();
    localStorage.setItem('maxmix.deviceConfig', JSON.stringify({ type: 'epaper' }));
    expect(cachedDeviceConfig()).toBeNull();
  });

  it('forgets the kept config, and copes without storage', () => {
    localStorage.setItem('maxmix.deviceConfig', JSON.stringify(fixture.config));
    forgetDeviceConfig();
    expect(cachedDeviceConfig()).toBeNull();
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => forgetDeviceConfig()).not.toThrow();
  });
});

describe('saveConfigSection', () => {
  const OWNED = fixture.config as TouchscreenConfig;
  const SECTION = fixture.section_save;

  /** Answers the config with `etag` as its version, then loads it, as the kiosk does at start. */
  async function loaded(etag: string) {
    register();
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          Response.json(fixture.config, {
            status: 200,
            headers: { 'Content-Type': 'application/json', ETag: etag }
          })
        )
      )
    );
    await loadDeviceConfig();
  }

  function saved(status = 200) {
    return vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(
        status === 200
          ? Response.json(SECTION.config, {
              status,
              headers: { 'Content-Type': 'application/json', ETag: SECTION.etag }
            })
          : new Response(null, { status })
      )
    );
  }

  it('puts the section whole with the version it was changed from, and keeps the answer and its version', async () => {
    await loaded(SECTION.if_match);
    const fetch = saved();
    vi.stubGlobal('fetch', fetch);
    const result = await saveConfigSection('style', SECTION.body as TouchscreenConfig['style']);
    expect(result).toEqual({ saved: SECTION.config });
    const [input, init] = fetch.mock.calls[0] ?? [''];
    const request = new Request(input, init);
    expect(request.method).toBe('PUT');
    expect(request.url).toBe(`https://countdown.build/api/devices/config/${SECTION.section}`);
    expect(request.headers.get('Authorization')).toBe(`Bearer ${SECRET}`);
    expect(request.headers.get('If-Match')).toBe(SECTION.if_match);
    await expect(request.json()).resolves.toEqual(SECTION.body);
    expect(cachedDeviceConfig()).toEqual(SECTION.config);

    // The next save goes from the version this one answered.
    await saveConfigSection('clock_format', '12h');
    const [nextInput, nextInit] = fetch.mock.calls[1] ?? [''];
    expect(new Request(nextInput, nextInit).headers.get('If-Match')).toBe(SECTION.etag);
  });

  it('sends saves one at a time, each from the version the one before answered', async () => {
    await loaded(SECTION.if_match);
    const fetch = saved();
    vi.stubGlobal('fetch', fetch);
    await Promise.all([
      saveConfigSection('clock_format', '12h'),
      saveConfigSection('display', { ...OWNED.display, sleep_minutes: 30 })
    ]);
    const versions = fetch.mock.calls.map(([input, init]) => new Request(input, init).headers.get('If-Match'));
    expect(versions).toEqual([SECTION.if_match, SECTION.etag]);
  });

  it('calls a stale or missing version a conflict, and anything else that goes wrong a failure', async () => {
    register();
    const fetch = saved();
    vi.stubGlobal('fetch', fetch);
    await expect(saveConfigSection('clock_format', '12h')).resolves.toEqual({ error: 'conflict' });
    expect(fetch).not.toHaveBeenCalled();

    await loaded(SECTION.if_match);
    vi.stubGlobal('fetch', saved(409));
    await expect(saveConfigSection('clock_format', '12h')).resolves.toEqual({ error: 'conflict' });
    vi.stubGlobal('fetch', saved(428));
    await expect(saveConfigSection('clock_format', '12h')).resolves.toEqual({ error: 'conflict' });
    vi.stubGlobal('fetch', saved(400));
    await expect(saveConfigSection('clock_format', '12h')).resolves.toEqual({ error: 'failed' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    );
    await expect(saveConfigSection('clock_format', '12h')).resolves.toEqual({ error: 'failed' });
  });

  it('saves nothing before the kiosk is registered', async () => {
    const fetch = saved();
    vi.stubGlobal('fetch', fetch);
    await expect(saveConfigSection('clock_format', '12h')).resolves.toEqual({ error: 'failed' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('answers as the server would in a build that mocks it', async () => {
    vi.stubEnv('VITE_COUNTDOWN_CONFIG', 'mock');
    const fetch = answer(500);
    await expect(saveConfigSection('clock_format', '12h')).resolves.toEqual({
      saved: { ...OWNED, clock_format: '12h' }
    });
    await expect(saveConfigSection('display', { ...OWNED.display, sleep_minutes: 30 })).resolves.toEqual({
      saved: { ...OWNED, clock_format: '12h', display: { ...OWNED.display, sleep_minutes: 30 } }
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
