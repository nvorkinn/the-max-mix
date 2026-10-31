import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getRedirectUri } from '../spotify/settings';
import { hidesCursor, isKiosk, openWifiSettings, WIFI_SETTINGS_URL } from './kiosk';

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

  it('opens the Wi-Fi panel through the custom scheme', () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    openWifiSettings();
    expect(WIFI_SETTINGS_URL).toBe('kiosk-wifi://open');
    expect(assign).toHaveBeenCalledWith('kiosk-wifi://open');
  });
});

describe('hidesCursor', () => {
  beforeEach(() => {
    localStorage.clear();
    visit('');
  });

  it('is off by default', () => {
    expect(hidesCursor()).toBe(false);
  });

  it('turns on with ?cursor=hidden and is remembered without the query', () => {
    visit('?kiosk=1&cursor=hidden');
    expect(hidesCursor()).toBe(true);
    visit('');
    expect(hidesCursor()).toBe(true);
  });

  it('is forgotten with ?cursor=shown', () => {
    visit('?cursor=hidden');
    hidesCursor();
    visit('?cursor=shown');
    expect(hidesCursor()).toBe(false);
    visit('');
    expect(hidesCursor()).toBe(false);
  });

  it('is independent of the kiosk flag', () => {
    visit('?kiosk=1');
    expect(hidesCursor()).toBe(false);
    expect(isKiosk()).toBe(true);
  });
});
