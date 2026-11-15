import { afterEach, describe, expect, it, vi } from 'vitest';
import { countdownApi, countdownServer } from './server';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('countdownServer', () => {
  it("is the build's settings site origin", () => {
    vi.stubEnv('VITE_COUNTDOWN_SERVER', 'https://app.countdown.build/');
    expect(countdownServer()).toBe('https://app.countdown.build');
  });

  it('is null when the build names no server, or one that is not an origin', () => {
    vi.stubEnv('VITE_COUNTDOWN_SERVER', '');
    expect(countdownServer()).toBeNull();
    vi.stubEnv('VITE_COUNTDOWN_SERVER', 'countdown.build');
    expect(countdownServer()).toBeNull();
  });
});

describe('countdownApi', () => {
  it("is the build's API origin, apart from the settings site's", () => {
    vi.stubEnv('VITE_COUNTDOWN_SERVER', 'https://app.countdown.build');
    vi.stubEnv('VITE_COUNTDOWN_API', 'https://api.countdown.build/');
    expect(countdownApi()).toBe('https://api.countdown.build');
  });

  it('is null when the build names no API, or one that is not an https origin', () => {
    vi.stubEnv('VITE_COUNTDOWN_API', '');
    expect(countdownApi()).toBeNull();
    vi.stubEnv('VITE_COUNTDOWN_API', 'wss://api.countdown.build');
    expect(countdownApi()).toBeNull();
  });
});
