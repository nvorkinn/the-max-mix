import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deviceCredentials,
  deviceSecret,
  forgetRegistration,
  keepDeviceId,
  kioskScreen,
  needsRegistration,
  pairingPageUrl,
  pairingState,
  pairingToken,
  registerScreen,
  secretHash
} from './registration';
import { countdownServer } from './server';

// countdown-api's touchscreen.json: the hash of its example secret, and the pairing token countdown-server derives
// from it (services/pairing.token_for).
const EXAMPLE_SECRET = 'example-not-a-real-secret-0001';
const EXAMPLE_HASH = 'e29484a427fb8d21c05a08648d91396508cb9179c4aff263ca74f0f3e3b97f3d';
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

describe('needsRegistration', () => {
  it('is true on a kiosk with no device ID', () => {
    visit('?kiosk=1');
    expect(needsRegistration()).toBe(true);
  });

  it('is false away from the kiosk, without the server or its API, or once registered', () => {
    expect(needsRegistration()).toBe(false);
    visit('?kiosk=1');
    vi.stubEnv('VITE_COUNTDOWN_SERVER', '');
    expect(needsRegistration()).toBe(false);
    vi.stubEnv('VITE_COUNTDOWN_SERVER', 'https://countdown.build');
    vi.stubEnv('VITE_COUNTDOWN_API', '');
    expect(needsRegistration()).toBe(false);
    vi.stubEnv('VITE_COUNTDOWN_API', 'https://api.countdown.build');
    localStorage.setItem('maxmix.deviceSecret', EXAMPLE_SECRET);
    localStorage.setItem('maxmix.deviceId', '0a1b2c3d4e5f');
    expect(needsRegistration()).toBe(false);
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
    expect(String(url)).toBe('https://api.countdown.build/api/devices/register');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ secret: EXAMPLE_SECRET, type: 'touchscreen', ...PI_SCREEN });
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
    expect(String(url)).toBe('https://api.countdown.build/api/devices/account');
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

  it('forgets the device ID and the secret', () => {
    localStorage.setItem('maxmix.deviceSecret', '0123abcd');
    localStorage.setItem('maxmix.deviceId', '0a1b2c3d4e5f');
    forgetRegistration();
    expect(deviceCredentials()).toBeNull();
    expect(localStorage.getItem('maxmix.deviceSecret')).toBeNull();
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
    expect(needsRegistration()).toBe(false);
    expect(keepDeviceId('0a1b2c3d4e5f')).toBe(false);
  });

  it('forgets nothing when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => forgetRegistration()).not.toThrow();
  });
});
