import { afterEach, describe, expect, it, vi } from 'vitest';
import { countdownServer } from './server';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('countdownServer', () => {
  it("is the build's server origin", () => {
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
