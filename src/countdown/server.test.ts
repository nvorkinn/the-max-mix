import { afterEach, describe, expect, it, vi } from 'vitest';
import { configEmbedEnabled, configSiteUrl } from './server';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('configSiteUrl', () => {
  it("is the device's page on the server, with embed=1 when embedded", () => {
    vi.stubEnv('VITE_COUNTDOWN_SERVER', 'https://app.countdown.build/');
    expect(configSiteUrl('d 1')).toBe('https://app.countdown.build/devices/d%201');
    expect(configSiteUrl('d1', true)).toBe('https://app.countdown.build/devices/d1?embed=1');
  });

  it("is the server's home page until the kiosk is registered", () => {
    vi.stubEnv('VITE_COUNTDOWN_SERVER', 'https://countdown.run');
    expect(configSiteUrl(null)).toBe('https://countdown.run/');
  });

  it('is null when the build names no server', () => {
    vi.stubEnv('VITE_COUNTDOWN_SERVER', '');
    expect(configSiteUrl('d1')).toBeNull();
  });
});

describe('configEmbedEnabled', () => {
  it('needs both the switch and a server', () => {
    vi.stubEnv('VITE_COUNTDOWN_SERVER', 'https://countdown.run');
    vi.stubEnv('VITE_COUNTDOWN_EMBED', 'off');
    expect(configEmbedEnabled()).toBe(false);
    vi.stubEnv('VITE_COUNTDOWN_EMBED', 'on');
    expect(configEmbedEnabled()).toBe(true);
    vi.stubEnv('VITE_COUNTDOWN_SERVER', '');
    expect(configEmbedEnabled()).toBe(false);
  });
});
