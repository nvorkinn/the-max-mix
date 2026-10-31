import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getRedirectUri } from '../spotify/settings';
import {
  hidesCursor,
  isKiosk,
  latestCommit,
  openWifiSettings,
  piVersion,
  rebootPi,
  restartKiosk,
  updateKiosk,
  WIFI_SETTINGS_URL
} from './kiosk';

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

describe('piVersion', () => {
  beforeEach(() => {
    localStorage.clear();
    visit('');
  });

  it('is unknown by default', () => {
    expect(piVersion()).toBeNull();
  });

  it('reads the kiosk address and remembers it without the query', () => {
    visit('?kiosk=1&cursor=hidden&pi_ref=stable&pi_commit=5a39e9a');
    expect(piVersion()).toEqual({ ref: 'stable', commit: '5a39e9a' });
    visit('?code=abc');
    expect(piVersion()).toEqual({ ref: 'stable', commit: '5a39e9a' });
  });

  it('is forgotten by a kiosk address without it', () => {
    visit('?kiosk=1&pi_ref=stable&pi_commit=5a39e9a');
    piVersion();
    visit('?kiosk=1');
    expect(piVersion()).toBeNull();
    visit('');
    expect(piVersion()).toBeNull();
  });

  it('rejects values that are not a ref and a commit', () => {
    for (const query of ['pi_ref=stable&pi_commit=xyz1234', 'pi_ref=a b&pi_commit=5a39e9a', 'pi_ref=stable']) {
      visit(`?kiosk=1&${query}`);
      expect(piVersion()).toBeNull();
    }
  });

  it('ignores the parameters without ?kiosk=1', () => {
    visit('?pi_ref=stable&pi_commit=5a39e9a');
    expect(piVersion()).toBeNull();
  });
});

describe('update, restart and reboot', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('open the kiosk-power scheme', () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    updateKiosk();
    restartKiosk();
    rebootPi();
    expect(assign.mock.calls).toEqual([['kiosk-power://update'], ['kiosk-power://restart'], ['kiosk-power://reboot']]);
  });
});

describe('latestCommit', () => {
  afterEach(() => vi.unstubAllGlobals());
  const sha = '0123456789abcdef0123456789abcdef01234567';

  it("asks GitHub for the ref's commit", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(`${sha}\n`));
    vi.stubGlobal('fetch', fetchMock);
    await expect(latestCommit('stable')).resolves.toBe(sha);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/nvorkinn/the-max-mix/commits/stable',
      expect.objectContaining({ headers: { Accept: 'application/vnd.github.sha' } })
    );
  });

  it('is null when GitHub fails or answers something else', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 403 })));
    await expect(latestCommit('stable')).resolves.toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>')));
    await expect(latestCommit('stable')).resolves.toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(latestCommit('stable')).resolves.toBeNull();
  });
});
