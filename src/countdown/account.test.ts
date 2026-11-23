import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json';
import { fetchDeviceAccount } from './account';
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
  localStorage.clear();
  vi.stubEnv('VITE_COUNTDOWN_API', 'https://countdown.build');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchDeviceAccount', () => {
  it('asks nothing of the server before the kiosk is registered', async () => {
    const fetch = answer(200, fixture.account);
    await expect(fetchDeviceAccount()).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("gets the owner's account's links with the device secret", async () => {
    register();
    const fetch = answer(200, fixture.account);
    await expect(fetchDeviceAccount()).resolves.toEqual({
      parcel: { linked: false },
      spotify: { linked: true },
      soloist: { linked: true }
    });
    const [input, init] = fetch.mock.calls[0] ?? [''];
    const request = new Request(input, init);
    expect(request.url).toBe('https://countdown.build/api/devices/account');
    expect(request.method).toBe('GET');
    expect(request.headers.get('Authorization')).toBe(`Bearer ${SECRET}`);
  });

  it('cannot tell when the server refuses, is from before the route, or cannot be reached', async () => {
    register();
    answer(409, { error: "the device isn't paired yet" });
    await expect(fetchDeviceAccount()).resolves.toBeNull();
    answer(404);
    await expect(fetchDeviceAccount()).resolves.toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    );
    await expect(fetchDeviceAccount()).resolves.toBeNull();
  });
});
