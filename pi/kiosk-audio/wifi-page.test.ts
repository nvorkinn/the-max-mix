/* eslint-disable sonarjs/no-clear-text-protocols -- the hotspot's page is plain http on a private address, by design */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drawQr, startPage } from './wifi-page.ts';
import { PAGE_HTML } from './wifi-setup.ts';

const NETWORKS = [
  { ssid: 'Home', bars: 4, security: 'psk' },
  { ssid: 'Cafe', bars: 2, security: 'open' },
  { ssid: 'Campus', bars: 3, security: 'unsupported' }
];

interface Call {
  path: string;
  body: unknown;
}

const HOTSPOT = {
  ssid: 'THE MAX MIX setup',
  password: 'ABCD2345EF',
  url: 'http://10.42.0.1/',
  wifiQr: ['1010', '0101', '1010', '0101'],
  urlQr: ['1100', '1100', '0011', '0011']
};

const state: {
  calls: Call[];
  connectReply: unknown;
  phoneReply: unknown;
  phoneStatus: number;
  hotspotReply: unknown;
  hotspotStatus: number;
  hotspotState: unknown;
} = {
  calls: [],
  connectReply: { ok: true },
  phoneReply: { ok: true },
  phoneStatus: 200,
  hotspotReply: HOTSPOT,
  hotspotStatus: 200,
  hotspotState: { state: 'running' }
};

beforeEach(() => {
  // The page's markup without its script, which loads the real modules.
  const parsed = new DOMParser().parseFromString(PAGE_HTML, 'text/html');
  for (const script of parsed.querySelectorAll('script')) script.remove();
  document.body.replaceChildren(...parsed.body.childNodes);
  state.calls = [];
  state.connectReply = { ok: true };
  state.phoneReply = { ok: true };
  state.phoneStatus = 200;
  state.hotspotReply = HOTSPOT;
  state.hotspotStatus = 200;
  state.hotspotState = { state: 'running' };
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string, init?: RequestInit) => {
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      state.calls.push({ path, body });
      if (path === '/wifi/networks') return Promise.resolve(Response.json({ networks: NETWORKS }));
      if (path === '/wifi/connect') return Promise.resolve(Response.json(state.connectReply));
      if (path === '/wifi/hotspot') {
        return Promise.resolve(
          init?.method === 'POST'
            ? Response.json(state.hotspotReply, { status: state.hotspotStatus })
            : Response.json(state.hotspotState)
        );
      }
      if (path === '/wifi/phone') {
        return Promise.resolve(Response.json(state.phoneReply, { status: state.phoneStatus }));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function byId(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`#${id}`);
  if (!found) throw new Error(`no #${id}`);
  return found;
}
const field = (id: string): HTMLInputElement => byId(id) as HTMLInputElement;
const networkButtons = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('.network')];
const posted = (path: string): unknown[] => state.calls.filter(call => call.path === path).map(call => call.body);

/** Opens the hotspot view on the page, once the service has answered. */
async function open() {
  await startPage(document, false).refresh();
  byId('hotspot').click();
  await vi.waitFor(() => {
    expect(byId('hotspot-view').hidden).toBe(false);
  });
}
/** How many times the page has asked where the hotspot is. */
const asks = () => state.calls.filter(call => call.path === '/wifi/hotspot' && call.body === undefined).length;
const later = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe('the Wi-Fi setup page', () => {
  it('lists the networks, with the ones it cannot join disabled', async () => {
    await startPage(document, false).refresh();
    expect(networkButtons().map(button => button.querySelector('.ssid')?.textContent)).toEqual([
      'Home',
      'Cafe',
      'Campus'
    ]);
    expect(networkButtons().map(button => button.disabled)).toEqual([false, false, true]);
    expect(byId('cancel').hidden).toBe(true);
  });

  it('asks for the password, joins, and closes', async () => {
    await startPage(document, true).refresh();
    networkButtons()[0]?.click();
    expect(byId('join-view').hidden).toBe(false);
    expect(byId('join-title').textContent).toBe('Join Home');
    expect(byId('name-row').hidden).toBe(true);
    field('password').value = 'right-password';
    byId('connect').click();
    await vi.waitFor(() => {
      expect(posted('/wifi/done')).toHaveLength(1);
    });
    expect(posted('/wifi/connect')).toEqual([
      { ssid: 'Home', password: 'right-password', hidden: false, security: 'psk' }
    ]);
  });

  it('joins an open network at once', async () => {
    await startPage(document, false).refresh();
    networkButtons()[1]?.click();
    await vi.waitFor(() => {
      expect(posted('/wifi/done')).toHaveLength(1);
    });
    expect(posted('/wifi/connect')).toEqual([{ ssid: 'Cafe', password: '', hidden: false, security: 'open' }]);
  });

  it('shows why joining failed and stays', async () => {
    state.connectReply = { ok: false, error: 'Wrong password. Check it and try again.' };
    await startPage(document, false).refresh();
    networkButtons()[0]?.click();
    field('password').value = 'wrong-password';
    byId('connect').click();
    await vi.waitFor(() => {
      expect(byId('error').textContent).toBe('Wrong password. Check it and try again.');
    });
    expect(byId('error').hidden).toBe(false);
    expect(byId('busy').hidden).toBe(true);
    expect(posted('/wifi/done')).toEqual([]);
  });

  it('joins a hidden network by name', async () => {
    await startPage(document, false).refresh();
    byId('other').click();
    expect(byId('name-row').hidden).toBe(false);
    field('name').value = ' Ghost ';
    byId('connect').click();
    await vi.waitFor(() => {
      expect(posted('/wifi/connect')).toEqual([{ ssid: 'Ghost', password: '', hidden: true, security: 'psk' }]);
    });
  });

  it('shows the password on request, and goes back to the list', async () => {
    await startPage(document, false).refresh();
    networkButtons()[0]?.click();
    byId('show').click();
    expect(field('password').type).toBe('text');
    byId('back').click();
    expect(byId('list-view').hidden).toBe(false);
    expect(byId('join-view').hidden).toBe(true);
  });

  it('keeps focus in the password box when Show is pressed, so the keyboard stays open', async () => {
    await startPage(document, false).refresh();
    networkButtons()[0]?.click();
    const password = field('password');
    password.focus();
    for (const type of ['pointerdown', 'mousedown']) {
      const press = new Event(type, { bubbles: true, cancelable: true });
      byId('show').dispatchEvent(press);
      expect(press.defaultPrevented).toBe(true);
    }
    byId('show').focus();
    byId('show').click();
    expect(document.activeElement).toBe(password);
  });

  it('closes on Cancel', async () => {
    await startPage(document, true).refresh();
    byId('cancel').click();
    await vi.waitFor(() => {
      expect(posted('/wifi/done')).toHaveLength(1);
    });
    expect(posted('/wifi/connect')).toEqual([]);
  });

  it('starts Wi-Fi setup from a phone and says how to use it', async () => {
    await startPage(document, false).refresh();
    expect(byId('phone-help').hidden).toBe(true);
    byId('phone').click();
    await vi.waitFor(() => {
      expect(byId('phone-help').hidden).toBe(false);
    });
    expect(posted('/wifi/phone')).toHaveLength(1);
    expect(byId('phone-help').textContent).toContain('improv-wifi.com');
    expect(byId('phone-help').textContent).toContain('THE MAX MIX');
    expect((byId('phone') as HTMLButtonElement).disabled).toBe(true);
  });

  it('says why phone setup could not start, and lets it be tried again', async () => {
    state.phoneStatus = 503;
    state.phoneReply = { error: 'Bluetooth is not available, so the phone cannot be used.' };
    await startPage(document, false).refresh();
    byId('phone').click();
    await vi.waitFor(() => {
      expect(byId('error').textContent).toBe('Bluetooth is not available, so the phone cannot be used.');
    });
    expect(byId('phone-help').hidden).toBe(true);
    expect((byId('phone') as HTMLButtonElement).disabled).toBe(false);
  });

  it('says when the service did not answer phone setup', async () => {
    await startPage(document, false).refresh();
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    byId('phone').click();
    await vi.waitFor(() => {
      expect(byId('error').textContent).toBe('Could not reach the kiosk service.');
    });
    expect((byId('phone') as HTMLButtonElement).disabled).toBe(false);
  });

  it('says when the scan failed', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ error: 'Wi-Fi is turned off.' })));
    await startPage(document, false).refresh();
    expect(byId('error').textContent).toBe('Wi-Fi is turned off.');
    expect(byId('status').textContent).toBe('No networks found. Tap Refresh to scan again.');
  });

  describe('the hotspot', () => {
    it('draws a QR code from rows of 0 and 1, with the quiet zone around it', () => {
      const container = document.createElement('div');
      drawQr(document, container, ['101', '010', '101']);
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('viewBox')).toBe('0 0 11 11');
      expect(svg?.querySelector('path')?.getAttribute('d')).toBe(
        'M4 4h1v1h-1zM6 4h1v1h-1zM5 5h1v1h-1zM4 6h1v1h-1zM6 6h1v1h-1z'
      );
      drawQr(document, container, ['11']);
      expect(container.querySelectorAll('svg')).toHaveLength(1);
    });

    it('shows how to join the hotspot, and where its page is, as text and as QR codes', async () => {
      await open();
      expect(posted('/wifi/hotspot')).toHaveLength(1);
      expect(byId('list-view').hidden).toBe(true);
      expect(byId('hotspot-name').textContent).toBe('THE MAX MIX setup');
      expect(byId('hotspot-password').textContent).toBe('ABCD2345EF');
      expect(byId('hotspot-url').textContent).toBe('http://10.42.0.1/');
      expect(byId('qr-wifi').querySelector('svg')).not.toBeNull();
      expect(byId('qr-url').querySelector('svg')).not.toBeNull();
      expect(byId('hotspot-status').textContent).toBe('Waiting for your phone…');
    });

    it('says why the hotspot could not start, and lets it be tried again', async () => {
      state.hotspotStatus = 503;
      state.hotspotReply = { error: 'There is no Wi-Fi adapter to make a hotspot with.' };
      await startPage(document, false).refresh();
      byId('hotspot').click();
      await vi.waitFor(() => {
        expect(byId('error').textContent).toBe('There is no Wi-Fi adapter to make a hotspot with.');
      });
      expect(byId('hotspot-view').hidden).toBe(true);
      expect((byId('hotspot') as HTMLButtonElement).disabled).toBe(false);
    });

    it('says when the service did not answer', async () => {
      await startPage(document, false).refresh();
      vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
      byId('hotspot').click();
      await vi.waitFor(() => {
        expect(byId('error').textContent).toBe('Could not reach the kiosk service.');
      });
    });

    it('goes back to the list, and stops the hotspot, on Back', async () => {
      await open();
      byId('hotspot-back').click();
      await vi.waitFor(() => {
        expect(byId('list-view').hidden).toBe(false);
      });
      expect(byId('hotspot-view').hidden).toBe(true);
      expect(posted('/wifi/hotspot/stop')).toHaveLength(1);
    });

    describe('while it is up', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      it('follows it: joining, then a failure to join, which stops the checking', async () => {
        await startPage(document, false).refresh();
        byId('hotspot').click();
        await later(0);
        state.hotspotState = { state: 'joining' };
        await later(2000);
        expect(byId('hotspot-status').textContent).toBe('The phone chose a network. The kiosk is joining it…');
        state.hotspotState = { state: 'failed', error: 'Could not join Home: Wrong password.' };
        await later(2000);
        expect(byId('hotspot-status').textContent).toBe('Could not join Home: Wrong password.');
        const checks = asks();
        await later(10_000);
        expect(asks()).toBe(checks);
      });

      it('returns to the list when the hotspot ended by itself', async () => {
        await startPage(document, false).refresh();
        byId('hotspot').click();
        await later(0);
        state.hotspotState = { state: 'idle' };
        await later(2000);
        expect(byId('list-view').hidden).toBe(false);
        expect(byId('error').textContent).toBe('The hotspot ended. Tap Hotspot to start it again.');
      });

      it('keeps asking while it is running, and survives a check that fails', async () => {
        await startPage(document, false).refresh();
        byId('hotspot').click();
        await later(0);
        vi.stubGlobal('fetch', () => Promise.reject(new TypeError('busy')));
        await later(2000);
        state.calls = [];
        vi.stubGlobal(
          'fetch',
          vi.fn((path: string) => {
            state.calls.push({ path, body: undefined });
            return Promise.resolve(Response.json({ state: 'running' }));
          })
        );
        await later(4000);
        expect(asks()).toBe(2);
        expect(byId('hotspot-view').hidden).toBe(false);
      });
    });
  });
});
