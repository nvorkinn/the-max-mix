import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { leaveFor } from '../spotify/settings';
import {
  completeRegistration,
  deviceCredentials,
  forgetRegistration,
  needsRegistration,
  registrationAddress,
  secretHash,
  startRegistration
} from './registration';
import { countdownServer } from './server';

vi.mock('../spotify/settings', () => ({ leaveFor: vi.fn() }));

// countdown-api's touchscreen.json: the hash of its example secret.
const EXAMPLE_SECRET = 'example-not-a-real-secret-0001';
const EXAMPLE_HASH = 'e29484a427fb8d21c05a08648d91396508cb9179c4aff263ca74f0f3e3b97f3d';

function visit(search: string) {
  history.replaceState(null, '', `/${search}`);
}

beforeEach(() => {
  localStorage.clear();
  visit('');
  vi.stubEnv('VITE_COUNTDOWN_SERVER', 'https://countdown.build');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.mocked(leaveFor).mockClear();
});

describe('the server setting', () => {
  it('reads the origin from the build', () => {
    vi.stubEnv('VITE_COUNTDOWN_SERVER', 'https://countdown.run/');
    expect(countdownServer()).toBe('https://countdown.run');
  });

  it('is unset without an https origin', () => {
    for (const value of ['', 'countdown.build', 'ftp://countdown.build']) {
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

  it('is false away from the kiosk, without a server, or once registered', () => {
    expect(needsRegistration()).toBe(false);
    visit('?kiosk=1');
    vi.stubEnv('VITE_COUNTDOWN_SERVER', '');
    expect(needsRegistration()).toBe(false);
    vi.stubEnv('VITE_COUNTDOWN_SERVER', 'https://countdown.build');
    localStorage.setItem('maxmix.deviceSecret', EXAMPLE_SECRET);
    localStorage.setItem('maxmix.deviceId', '0a1b2c3d4e5f');
    expect(needsRegistration()).toBe(false);
  });
});

describe('registering', () => {
  it('sends only the secret hash, the screen size and the way back', async () => {
    const address = new URL(await registrationAddress('https://countdown.build', EXAMPLE_SECRET));
    expect(address.origin + address.pathname).toBe('https://countdown.build/register');
    expect(Object.fromEntries(address.searchParams)).toEqual({
      secret_hash: EXAMPLE_HASH,
      width: String(screen.width),
      height: String(screen.height),
      return_to: `${location.origin}/?countdown=registered`
    });
    expect(address.href).not.toContain(EXAMPLE_SECRET);
  });

  it('hashes as lowercase hex SHA-256', async () => {
    expect(await secretHash(EXAMPLE_SECRET)).toBe(EXAMPLE_HASH);
  });

  it('makes up a secret once and keeps it for a retry', async () => {
    const leave = vi.mocked(leaveFor);
    await startRegistration();
    const secret = localStorage.getItem('maxmix.deviceSecret');
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    await startRegistration();
    expect(localStorage.getItem('maxmix.deviceSecret')).toBe(secret);
    expect(leave).toHaveBeenCalledTimes(2);
    expect(leave.mock.calls[0]?.[0]).toContain(`secret_hash=${await secretHash(secret ?? '')}`);
  });
});

describe('completeRegistration', () => {
  it('ignores any other address, a Spotify error among them', () => {
    visit('?error=access_denied');
    expect(completeRegistration()).toBeNull();
    expect(location.search).toBe('?error=access_denied');
  });

  it('keeps the device ID and clears the address', () => {
    localStorage.setItem('maxmix.deviceSecret', EXAMPLE_SECRET);
    visit('?countdown=registered&device_id=0a1b2c3d4e5f');
    expect(completeRegistration()).toEqual({ ok: true, deviceId: '0a1b2c3d4e5f' });
    expect(location.search).toBe('');
    expect(deviceCredentials()).toEqual({ deviceId: '0a1b2c3d4e5f', secret: EXAMPLE_SECRET });
  });

  it('says when someone else owns the screen', () => {
    localStorage.setItem('maxmix.deviceSecret', EXAMPLE_SECRET);
    visit('?countdown=registered&error=taken');
    expect(completeRegistration()).toEqual({ ok: false, error: 'taken' });
    expect(location.search).toBe('');
    expect(deviceCredentials()).toBeNull();
  });

  it('rejects a device ID it has no secret for, or that is not an ID', () => {
    visit('?countdown=registered&device_id=0a1b2c3d4e5f');
    expect(completeRegistration()).toEqual({ ok: false, error: 'unknown' });
    localStorage.setItem('maxmix.deviceSecret', EXAMPLE_SECRET);
    visit('?countdown=registered&device_id=not%20an%20id');
    expect(completeRegistration()).toEqual({ ok: false, error: 'unknown' });
  });

  it('copes with storage that cannot keep the device ID', () => {
    localStorage.setItem('maxmix.deviceSecret', EXAMPLE_SECRET);
    visit('?countdown=registered&device_id=0a1b2c3d4e5f&kiosk=1');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(completeRegistration()).toEqual({ ok: false, error: 'storage' });
    expect(location.search).toBe('?kiosk=1');
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
  });

  it('does nothing without a server', async () => {
    vi.stubEnv('VITE_COUNTDOWN_SERVER', '');
    const leave = vi.mocked(leaveFor);
    await startRegistration();
    expect(leave).not.toHaveBeenCalled();
  });

  it('ignores a server that is not a URL', () => {
    vi.stubEnv('VITE_COUNTDOWN_SERVER', 'https://');
    expect(countdownServer()).toBeNull();
  });

  it('forgets nothing when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => forgetRegistration()).not.toThrow();
  });
});

describe('forgetRegistration', () => {
  it('forgets the device ID and the secret', () => {
    localStorage.setItem('maxmix.deviceSecret', '0123abcd');
    localStorage.setItem('maxmix.deviceId', '0a1b2c3d4e5f');
    forgetRegistration();
    expect(deviceCredentials()).toBeNull();
    expect(localStorage.getItem('maxmix.deviceSecret')).toBeNull();
  });
});
