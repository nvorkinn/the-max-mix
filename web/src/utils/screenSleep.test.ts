import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getScreenSleep, setScreenSleep, wakeDisplay } from './screenSleep';

describe('screen sleep setting', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('is 5 minutes by default', () => {
    expect(getScreenSleep()).toBe(5);
  });

  it('remembers a choice, including never', () => {
    setScreenSleep(15);
    expect(getScreenSleep()).toBe(15);
    setScreenSleep(0);
    expect(getScreenSleep()).toBe(0);
    setScreenSleep(5);
    expect(localStorage.getItem('maxmix.screenSleep')).toBeNull();
  });

  it('ignores a stored value that is not one of the choices', () => {
    localStorage.setItem('maxmix.screenSleep', '7');
    expect(getScreenSleep()).toBe(5);
    localStorage.setItem('maxmix.screenSleep', 'soon');
    expect(getScreenSleep()).toBe(5);
  });

  it('falls back to the default when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(getScreenSleep()).toBe(5);
  });
});

describe('wakeDisplay', () => {
  it('asks the kiosk service to turn the screen on', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    wakeDisplay();
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7341/display/wake', { method: 'POST' });
    vi.unstubAllGlobals();
  });
});
