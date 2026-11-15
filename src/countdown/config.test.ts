import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json';
import { cachedDeviceConfig, loadDeviceConfig } from './config';
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
});
