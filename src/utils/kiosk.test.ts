import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isKiosk, WIFI_PORTAL_URL } from './kiosk';
import { getRedirectUri } from '../spotify/settings';

function visit(search: string) {
  history.replaceState(null, '', `/${search}`);
}

describe('isKiosk', () => {
  beforeEach(() => {
    localStorage.clear();
    visit('');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is off by default', () => {
    expect(isKiosk()).toBe(false);
  });

  it('turns on with ?kiosk=1 and is remembered without the query', () => {
    visit('?kiosk=1');
    expect(isKiosk()).toBe(true);
    visit('');
    expect(isKiosk()).toBe(true);
  });

  it('is forgotten with ?kiosk=0', () => {
    visit('?kiosk=1');
    isKiosk();
    visit('?kiosk=0');
    expect(isKiosk()).toBe(false);
    visit('');
    expect(isKiosk()).toBe(false);
  });

  it('ignores other values', () => {
    visit('?kiosk=yes');
    expect(isKiosk()).toBe(false);
    expect(localStorage.getItem('maxmix.kiosk')).toBeNull();
  });

  it('coexists with ?demo=true', () => {
    visit('?kiosk=1&demo=true');
    expect(isKiosk()).toBe(true);
    expect(new URLSearchParams(location.search).get('demo')).toBe('true');
  });

  it('never changes the Spotify redirect address', () => {
    visit('?kiosk=1');
    isKiosk();
    expect(getRedirectUri()).toBe(`${location.origin}/`);
    expect(getRedirectUri()).not.toContain('kiosk');
  });

  it('copes with unavailable storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      }
    });
    expect(isKiosk()).toBe(false);
    visit('?kiosk=1');
    expect(isKiosk()).toBe(true);
    visit('?kiosk=0');
    expect(isKiosk()).toBe(false);
  });

  it('points at the portal on the Pi itself', () => {
    expect(WIFI_PORTAL_URL).toBe('http://127.0.0.1:8088/');
  });
});
