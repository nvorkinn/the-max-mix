import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SetupStatus } from 'countdown-api';
import touchscreen from '../../../vendor/countdown-api/src/countdown_api/fixtures/touchscreen.json';
import { SCOPES } from '../spotify/auth';
import {
  deviceCredentials,
  deviceSecret,
  finishSetup,
  forgetRegistration,
  forgetSetupVerifier,
  keepDeviceId,
  kioskScreen,
  needsSetup,
  pairingPageUrl,
  pairingState,
  pairingToken,
  registerScreen,
  secretHash,
  sendSetupReport,
  setupStart,
  setupStatus,
  setupVerifier
} from './registration';
import { countdownServer } from './server';

// countdown-api's touchscreen.json: the hash of its example secret, and the pairing token countdown-server derives
// from it (services/pairing.token_for).
const EXAMPLE_SECRET = 'example-not-a-real-secret-0001';
const EXAMPLE_HASH = 'e29484a427fb8d21c05a08648d91396508cb9179c4aff263ca74f0f3e3b97f3d';
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const EXAMPLE_TOKEN = '20566a32ebc64dd5e6d4d4bdf85263aaa586cb01ddd8c6ccd7056f16b430fe40';
// What the-max-mix's kiosk service answers GET /screen with: an HDMI 1280x800 panel, which has no backlight.
const PI_SCREEN = { width: 1280, height: 800, brightness_control: false };

function answers(answer: Response | Error) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer.clone())));
}

function visit(search: string) {
  history.replaceState(null, '', `/${search}`);
}

beforeEach(() => {
  localStorage.clear();
  visit('');
  vi.stubEnv('VITE_COUNTDOWN_SERVER', 'https://countdown.build');
  vi.stubEnv('VITE_COUNTDOWN_API', 'https://api.countdown.build');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the server setting', () => {
  it('reads the origin from the build', () => {
    vi.stubEnv('VITE_COUNTDOWN_SERVER', 'https://countdown.run/');
    expect(countdownServer()).toBe('https://countdown.run');
  });

  it('is unset without an https origin', () => {
    for (const value of ['', 'https://', 'countdown.build', 'ftp://countdown.build']) {
      vi.stubEnv('VITE_COUNTDOWN_SERVER', value);
      expect(countdownServer()).toBeNull();
    }
  });
});

describe('needsSetup', () => {
  it('is true on a kiosk that has not finished its setup, even once registered', () => {
    visit('?kiosk=1');
    expect(needsSetup()).toBe(true);
    localStorage.setItem('maxmix.deviceSecret', EXAMPLE_SECRET);
    localStorage.setItem('maxmix.deviceId', '0a1b2c3d4e5f');
    expect(needsSetup()).toBe(true);
  });

  it('is false away from the kiosk, without the server or its API, or once the setup is finished', () => {
    expect(needsSetup()).toBe(false);
    visit('?kiosk=1');
    vi.stubEnv('VITE_COUNTDOWN_SERVER', '');
    expect(needsSetup()).toBe(false);
    vi.stubEnv('VITE_COUNTDOWN_SERVER', 'https://countdown.build');
    vi.stubEnv('VITE_COUNTDOWN_API', '');
    expect(needsSetup()).toBe(false);
    vi.stubEnv('VITE_COUNTDOWN_API', 'https://api.countdown.build');
    finishSetup();
    expect(needsSetup()).toBe(false);
  });
});

describe('the secret and the pairing token', () => {
  it('makes up a secret once and keeps it', () => {
    const secret = deviceSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(deviceSecret()).toBe(secret);
  });

  it('hashes as lowercase hex SHA-256', async () => {
    expect(await secretHash(EXAMPLE_SECRET)).toBe(EXAMPLE_HASH);
  });

  it('derives the pairing token as countdown-server does', async () => {
    expect(await pairingToken(EXAMPLE_SECRET)).toBe(EXAMPLE_TOKEN);
  });

  it('puts only the token in the pairing page address', () => {
    expect(pairingPageUrl('https://countdown.build', EXAMPLE_TOKEN)).toBe(
      `https://countdown.build/pair/add?t=${EXAMPLE_TOKEN}`
    );
  });
});

describe('registerScreen', () => {
  it('registers as a touchscreen with the screen as the Pi reports it', async () => {
    const fetch = answers(Response.json({ device_id: '0a1b2c3d4e5f' }, { status: 201 }));
    expect(await registerScreen(EXAMPLE_SECRET, PI_SCREEN)).toBe('0a1b2c3d4e5f');
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect((url as URL).href).toBe('https://api.countdown.build/api/devices/register');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ secret: EXAMPLE_SECRET, type: 'touchscreen', ...PI_SCREEN });
  });

  it('answers null when the server refuses or cannot be reached', async () => {
    for (const answer of [
      Response.json({ error: 'too many devices waiting' }, { status: 503 }),
      new Error('Failed to fetch'),
      Response.json({ device_id: 'not an id' })
    ]) {
      answers(answer);
      // eslint-disable-next-line no-await-in-loop
      expect(await registerScreen(EXAMPLE_SECRET, PI_SCREEN)).toBeNull();
    }
  });
});

describe('pairingState', () => {
  it('asks for the account with the secret', async () => {
    const fetch = answers(Response.json({ parcel: { linked: false }, spotify: { linked: true } }));
    expect(await pairingState(EXAMPLE_SECRET)).toBe('paired');
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect((url as URL).href).toBe('https://api.countdown.build/api/devices/account');
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${EXAMPLE_SECRET}`);
  });

  it('waits while nobody owns it, and says when the server has forgotten it', async () => {
    answers(Response.json({ error: "the device isn't paired yet" }, { status: 409 }));
    expect(await pairingState(EXAMPLE_SECRET)).toBe('waiting');
    answers(Response.json({ error: 'unknown device' }, { status: 401 }));
    expect(await pairingState(EXAMPLE_SECRET)).toBe('unregistered');
    answers(new Error('Failed to fetch'));
    expect(await pairingState(EXAMPLE_SECRET)).toBe('unknown');
  });
});

describe('kioskScreen', () => {
  it('reads a DSI panel that can set its brightness', async () => {
    answers(Response.json({ width: 1024, height: 600, brightness_control: true }));
    expect(await kioskScreen()).toEqual({ width: 1024, height: 600, brightness_control: true });
  });

  it('answers null when the Pi cannot say', async () => {
    for (const answer of [
      new Error('Failed to fetch'),
      new Response(null, { status: 503 }),
      Response.json({ width: 1280, height: 800 }),
      Response.json({ width: 0, height: 800, brightness_control: true })
    ]) {
      answers(answer);
      // eslint-disable-next-line no-await-in-loop
      expect(await kioskScreen()).toBeNull();
    }
  });
});

describe('keeping the device', () => {
  it('keeps the device ID beside the secret', () => {
    const secret = deviceSecret();
    expect(keepDeviceId('0a1b2c3d4e5f')).toBe(true);
    expect(deviceCredentials()).toEqual({ deviceId: '0a1b2c3d4e5f', secret });
  });

  it('forgets the device ID, the secret and the finished setup', () => {
    localStorage.setItem('maxmix.deviceSecret', '0123abcd');
    localStorage.setItem('maxmix.deviceId', '0a1b2c3d4e5f');
    localStorage.setItem('maxmix.setupVerifier', RFC_VERIFIER);
    finishSetup();
    forgetRegistration();
    expect(deviceCredentials()).toBeNull();
    expect(localStorage.getItem('maxmix.deviceSecret')).toBeNull();
    expect(localStorage.getItem('maxmix.setupDone')).toBeNull();
    expect(setupVerifier()).toBeNull();
  });
});

describe('the first setup report', () => {
  it("is the first person's Spotify sign-in, with the challenge of a verifier the kiosk keeps", async () => {
    // RFC 7636's example verifier, whose challenge is countdown-api's example report's.
    localStorage.setItem('maxmix.setupVerifier', RFC_VERIFIER);
    expect(await setupStart()).toEqual({ spotify: { ...touchscreen.setup_start.spotify, scope: SCOPES } });
    expect(setupVerifier()).toBe(RFC_VERIFIER);
  });

  it('makes the verifier the first time, and sends the same challenge from then on', async () => {
    expect(setupVerifier()).toBeNull();
    const first = await setupStart();
    const verifier = setupVerifier();
    expect(verifier).toMatch(/^[\w-]{43,128}$/);
    expect(first.spotify).toMatchObject({ client_id: touchscreen.setup_start.spotify.client_id, scope: SCOPES });
    expect(first.spotify?.code_challenge).toMatch(/^[\w-]{43}$/);
    expect(await setupStart()).toEqual(first);
    expect(setupVerifier()).toBe(verifier);
  });

  it('forgets the verifier once the sign-in is done', async () => {
    await setupStart();
    forgetSetupVerifier();
    expect(setupVerifier()).toBeNull();
  });

  it('says nothing of Spotify once someone is signed in on the kiosk', async () => {
    localStorage.setItem(
      'maxmix.people',
      JSON.stringify({
        clientId: touchscreen.setup_start.spotify.client_id,
        active: 'max',
        people: [{ spotifyId: 'max', name: 'Max', imageUrl: '', refreshToken: 'r', phoneAddress: '' }]
      })
    );
    expect(await setupStart()).toEqual({});
    expect(setupVerifier()).toBeNull();
  });

  it('still answers the report when the verifier cannot be kept', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const start = await setupStart();
    expect(start.spotify?.code_challenge).toMatch(/^[\w-]{43}$/);
    expect(() => forgetSetupVerifier()).not.toThrow();
  });
});

describe('the setup on the server', () => {
  const STATUS = touchscreen.setup_spotify as SetupStatus;

  it('reports with the secret alone, before anyone owns the kiosk, and answers where the setup stands', async () => {
    const secret = deviceSecret();
    const fetch = answers(Response.json(touchscreen.setup_account));
    expect(await sendSetupReport(touchscreen.setup_start)).toEqual(touchscreen.setup_account);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect((url as URL).href).toBe('https://api.countdown.build/api/devices/setup');
    expect(init?.method).toBe('PUT');
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${secret}`);
    expect(JSON.parse(init?.body as string)).toEqual(touchscreen.setup_start);
  });

  it('tells a server without the route from one that cannot be asked now', async () => {
    deviceSecret();
    answers(new Response(null, { status: 404 }));
    expect(await sendSetupReport({ phone_paired: true })).toBe('unsupported');
    answers(Response.json({ error: 'unknown device' }, { status: 401 }));
    expect(await sendSetupReport({ phone_paired: true })).toBeNull();
    answers(new Error('Failed to fetch'));
    expect(await sendSetupReport({ phone_paired: true })).toBeNull();
  });

  it('asks where the setup stands', async () => {
    const secret = deviceSecret();
    const fetch = answers(Response.json(STATUS));
    const controller = new AbortController();
    expect(await setupStatus(controller.signal)).toEqual(STATUS);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect((url as URL).href).toBe('https://api.countdown.build/api/devices/setup');
    expect(init?.method).toBe('GET');
    expect(init?.signal).toBe(controller.signal);
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${secret}`);
  });

  it('says when the server has no setup for the kiosk, and when it cannot be asked', async () => {
    deviceSecret();
    answers(new Response(null, { status: 404 }));
    expect(await setupStatus()).toBe('unreported');
    answers(Response.json({ error: 'unknown device' }, { status: 401 }));
    expect(await setupStatus()).toBeNull();
    answers(new Error('Failed to fetch'));
    expect(await setupStatus()).toBeNull();
  });

  it('tells a server whose preflight fails for want of the route, by asking with nothing to preflight', async () => {
    deviceSecret();
    // A browser fails the call itself, as it does off the network; the plain ask after it is answered.
    const preflightFails = (probe: Response) =>
      vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation((_url, init) =>
          init === undefined ? Promise.resolve(probe.clone()) : Promise.reject(new TypeError('Failed to fetch'))
        );
    const fetch = preflightFails(new Response('Not Found', { status: 404 }));
    expect(await sendSetupReport({ phone_paired: true })).toBe('unsupported');
    expect(await setupStatus()).toBe('unreported');
    const [url, init] = fetch.mock.calls[1] ?? [];
    expect((url as URL).href).toBe('https://api.countdown.build/api/devices/setup');
    expect(init).toBeUndefined();
    // A server with the route turns the plain ask away for its missing secret: the call failed for another reason.
    preflightFails(Response.json({ error: 'missing secret' }, { status: 401 }));
    expect(await sendSetupReport({ phone_paired: true })).toBeNull();
    expect(await setupStatus()).toBeNull();
  });

  it('asks nothing without a secret, or a server named in the build', async () => {
    const fetch = answers(Response.json(STATUS));
    expect(await setupStatus()).toBeNull();
    expect(await sendSetupReport({})).toBeNull();
    deviceSecret();
    vi.stubEnv('VITE_COUNTDOWN_API', '');
    expect(await setupStatus()).toBeNull();
    expect(await sendSetupReport({}, new AbortController().signal)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('without storage', () => {
  it('neither registers nor reads credentials', () => {
    visit('?kiosk=1');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(deviceCredentials()).toBeNull();
    expect(needsSetup()).toBe(false);
    expect(keepDeviceId('0a1b2c3d4e5f')).toBe(false);
  });

  it('forgets nothing when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => forgetRegistration()).not.toThrow();
  });
});
