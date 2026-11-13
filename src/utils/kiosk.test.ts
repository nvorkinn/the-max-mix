import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getRedirectUri } from '../spotify/settings';
import {
  forgetSignIns,
  isKiosk,
  isRelease,
  latestCommit,
  latestRelease,
  getKioskLocation,
  openWifiSettings,
  piVersion,
  rebootPi,
  restartKiosk
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

  it('asks the kiosk service to show the Wi-Fi panel', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    openWifiSettings();
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7341/wifi', { method: 'POST' });
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
    visit('?kiosk=1&pi_ref=v1.12.0&pi_commit=5a39e9a');
    expect(piVersion()).toEqual({ ref: 'v1.12.0', commit: '5a39e9a' });
    visit('?code=abc');
    expect(piVersion()).toEqual({ ref: 'v1.12.0', commit: '5a39e9a' });
  });

  it('is forgotten by a kiosk address without it', () => {
    visit('?kiosk=1&pi_ref=v1.12.0&pi_commit=5a39e9a');
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
    visit('?pi_ref=v1.12.0&pi_commit=5a39e9a');
    expect(piVersion()).toBeNull();
  });
});

describe('restart and reboot', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ask the kiosk service', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    restartKiosk();
    rebootPi();
    expect(fetchMock.mock.calls).toEqual([
      ['http://127.0.0.1:7341/power/restart', { method: 'POST' }],
      ['http://127.0.0.1:7341/power/reboot', { method: 'POST' }]
    ]);
  });
});

describe('forgetSignIns', () => {
  beforeEach(() => {
    localStorage.clear();
    visit('');
  });
  afterEach(() => vi.useRealTimers());

  it('asks nothing outside the kiosk', async () => {
    const posted = vi.spyOn(window, 'postMessage');
    await forgetSignIns();
    expect(posted).not.toHaveBeenCalled();
  });

  it('asks the kiosk extension and waits for its answer', async () => {
    visit('?kiosk=1');
    const asked: unknown[] = [];
    const extension = (event: MessageEvent) => {
      asked.push(event.data);
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'other' }, source: window }));
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'maxmix:sign-ins-forgotten' } }));
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'maxmix:sign-ins-forgotten' }, source: window }));
    };
    window.addEventListener('message', extension, { once: true });
    await forgetSignIns();
    expect(asked).toEqual([{ type: 'maxmix:forget-sign-ins' }]);
  });

  it('gives up when no extension answers', async () => {
    vi.useFakeTimers();
    visit('?kiosk=1');
    vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    let done = false;
    const forgetting = forgetSignIns().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(2999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await forgetting;
    expect(done).toBe(true);
  });
});

describe('isRelease', () => {
  it('tells release tags from branches', () => {
    expect(isRelease('v1.12.0')).toBe(true);
    expect(isRelease('stable')).toBe(false);
    expect(isRelease('main')).toBe(false);
    expect(isRelease('v')).toBe(false);
  });
});

describe('latestRelease', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks GitHub for the latest release's tag", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ tag_name: 'v1.12.0', name: 'v1.12.0' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(latestRelease()).resolves.toBe('v1.12.0');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/nvorkinn/the-max-mix/releases/latest',
      expect.objectContaining({ headers: { Accept: 'application/vnd.github+json' } })
    );
  });

  it('is null when GitHub fails or answers something else', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 403 })));
    await expect(latestRelease()).resolves.toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ tag_name: 'stable' })));
    await expect(latestRelease()).resolves.toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>')));
    await expect(latestRelease()).resolves.toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(latestRelease()).resolves.toBeNull();
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

describe('getKioskLocation', () => {
  beforeEach(() => {
    localStorage.clear();
    visit('');
  });

  it('reads ?lat= and ?lon= from the kiosk address without storing them', () => {
    visit('?kiosk=1&lat=51.51&lon=-0.13');
    expect(getKioskLocation()).toEqual({ lat: 51.51, lon: -0.13 });
    expect(localStorage).toHaveLength(0);
    visit('');
    expect(getKioskLocation()).toBeNull();
  });

  it('ignores a missing half, values off the globe, and addresses that are not the kiosk', () => {
    const broken = ['?kiosk=1&lat=51.51', '?kiosk=1&lat=91&lon=0', '?kiosk=1&lat=10&lon=181', '?kiosk=1&lat=x&lon=1'];
    for (const search of [...broken, '?lat=51.51&lon=-0.13']) {
      visit(search);
      expect(getKioskLocation()).toBeNull();
    }
  });
});
