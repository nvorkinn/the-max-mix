import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json';
import { KIOSK_SERVICE } from '../utils/kioskService';
import * as registration from './registration';
import { handOverSoloistKey } from './soloist';

const SECRET = fixture.registration.secret;
const KEY = 'soloist-key-for-tests';

function register() {
  vi.spyOn(registration, 'deviceCredentials').mockReturnValue({ deviceId: fixture.device_id, secret: SECRET });
}

/** The server answers `server`; the kiosk's service answers `kiosk`. */
function answer(server: { status: number; body?: unknown }, kiosk = 200) {
  const fetch = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(input => {
    const url = new Request(input).url;
    if (url.startsWith(KIOSK_SERVICE)) return Promise.resolve(new Response('{"state":"stored"}', { status: kiosk }));
    return Promise.resolve(
      new Response(server.body === undefined ? null : JSON.stringify(server.body), {
        status: server.status,
        headers: { 'Content-Type': 'application/json' }
      })
    );
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv('VITE_COUNTDOWN_API', 'https://countdown.build');
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('handOverSoloistKey', () => {
  it('asks nothing before the kiosk is registered', async () => {
    const fetch = answer({ status: 200, body: { api_key: KEY } });
    await expect(handOverSoloistKey()).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fetches the key with the device secret and hands it to the kiosk's service", async () => {
    register();
    const fetch = answer({ status: 200, body: { api_key: KEY } });

    await expect(handOverSoloistKey()).resolves.toBe(true);

    const [server, kiosk] = fetch.mock.calls.map(([input, init]) => new Request(input, init));
    expect(server?.url).toBe('https://countdown.build/api/devices/soloist/key');
    expect(server?.headers.get('Authorization')).toBe(`Bearer ${SECRET}`);
    expect(kiosk?.url).toBe(`${KIOSK_SERVICE}/soloist/key`);
    expect(kiosk?.method).toBe('POST');
    expect(await kiosk?.json()).toEqual({ api_key: KEY });
  });

  it('hands nothing over while the kiosk is not paired', async () => {
    register();
    const fetch = answer({ status: 409, body: { error: 'only a paired touchscreen gets the Soloist key' } });
    await expect(handOverSoloistKey()).resolves.toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("is not done when the kiosk's service could not store it", async () => {
    register();
    answer({ status: 200, body: { api_key: KEY } }, 503);
    await expect(handOverSoloistKey()).resolves.toBe(false);
  });
});
