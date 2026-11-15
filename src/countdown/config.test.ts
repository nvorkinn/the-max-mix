import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TouchscreenConfig } from 'countdown-api';
import fixture from '../../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json';
import { cachedDeviceConfig, forgetDeviceConfig, loadDeviceConfig, saveConfigSection } from './config';
import * as registration from './registration';

const SECRET = fixture.registration.secret;

function register() {
  vi.spyOn(registration, 'deviceCredentials').mockReturnValue({ deviceId: fixture.device_id, secret: SECRET });
}

function answer(status: number, body?: unknown) {
  const fetch = vi.fn<(request: Request) => Promise<Response>>(() =>
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
  localStorage.clear();
  vi.stubEnv('VITE_COUNTDOWN_SERVER', 'https://countdown.build');
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
    const request = fetch.mock.calls[0]?.[0];
    expect(request?.url).toBe('https://countdown.build/api/devices/config');
    expect(request?.method).toBe('GET');
    expect(request?.headers.get('Authorization')).toBe(`Bearer ${SECRET}`);
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

  it('puts the whole config with the section changed, with the device secret, and keeps the answer', async () => {
    register();
    const fetch = answer(200, fixture.save);
    const result = await saveConfigSection(OWNED, 'display', { sleep_minutes: 30 });
    expect(result).toEqual({ saved: fixture.save });
    const request = fetch.mock.calls[0]?.[0];
    expect(request?.method).toBe('PUT');
    expect(request?.url).toBe('https://countdown.build/api/devices/config');
    expect(request?.headers.get('Authorization')).toBe(`Bearer ${SECRET}`);
    await expect(request?.json()).resolves.toEqual({ ...OWNED, display: { sleep_minutes: 30 } });
    expect(cachedDeviceConfig()).toEqual(fixture.save);
  });

  it('calls a 409 a conflict, and anything else that goes wrong a failure', async () => {
    register();
    answer(409);
    await expect(saveConfigSection(OWNED, 'clock_format', '12h')).resolves.toEqual({ error: 'conflict' });
    answer(400);
    await expect(saveConfigSection(OWNED, 'clock_format', '12h')).resolves.toEqual({ error: 'failed' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    );
    await expect(saveConfigSection(OWNED, 'clock_format', '12h')).resolves.toEqual({ error: 'failed' });
  });

  it('saves nothing before the kiosk is registered', async () => {
    const fetch = answer(200, fixture.save);
    await expect(saveConfigSection(OWNED, 'clock_format', '12h')).resolves.toEqual({ error: 'failed' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('answers as the server would in a build that mocks it', async () => {
    vi.stubEnv('VITE_COUNTDOWN_CONFIG', 'mock');
    const fetch = answer(500);
    await expect(saveConfigSection(OWNED, 'clock_format', '12h')).resolves.toEqual({
      saved: { ...OWNED, clock_format: '12h' }
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
