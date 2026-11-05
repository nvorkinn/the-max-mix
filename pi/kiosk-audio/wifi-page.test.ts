import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPage } from './wifi-page.ts';
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

const state: { calls: Call[]; connectReply: unknown } = { calls: [], connectReply: { ok: true } };

beforeEach(() => {
  // The page's markup without its script, which loads the real modules.
  const parsed = new DOMParser().parseFromString(PAGE_HTML, 'text/html');
  for (const script of parsed.querySelectorAll('script')) script.remove();
  document.body.replaceChildren(...parsed.body.childNodes);
  state.calls = [];
  state.connectReply = { ok: true };
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string, init?: RequestInit) => {
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      state.calls.push({ path, body });
      if (path === '/wifi/networks') return Promise.resolve(Response.json({ networks: NETWORKS }));
      if (path === '/wifi/connect') return Promise.resolve(Response.json(state.connectReply));
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

  it('says when the scan failed', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ error: 'Wi-Fi is turned off.' })));
    await startPage(document, false).refresh();
    expect(byId('error').textContent).toBe('Wi-Fi is turned off.');
    expect(byId('status').textContent).toBe('No networks found. Tap Refresh to scan again.');
  });
});
