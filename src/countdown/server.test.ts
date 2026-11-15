import { afterEach, describe, expect, it, vi } from 'vitest';
import { configSiteUrl } from './server';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('configSiteUrl', () => {
  it("is the device's page on the server, in its embedded mode", () => {
    vi.stubEnv('VITE_COUNTDOWN_SERVER', 'https://app.countdown.build/');
    expect(configSiteUrl('d 1')).toBe('https://app.countdown.build/devices/d%201?embed=1');
  });

  it("is the server's home page until the kiosk is registered", () => {
    vi.stubEnv('VITE_COUNTDOWN_SERVER', 'https://countdown.run');
    expect(configSiteUrl(null)).toBe('https://countdown.run/?embed=1');
  });

  it('is null when the build names no server', () => {
    vi.stubEnv('VITE_COUNTDOWN_SERVER', '');
    expect(configSiteUrl('d1')).toBeNull();
  });
});
