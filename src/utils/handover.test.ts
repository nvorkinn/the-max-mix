import { afterEach, describe, expect, it, vi } from 'vitest';
import { handoverItems, isLocalCopy, TAKEN_KEY, takeHandover } from './handover';

function storage(items: Record<string, string>): Storage {
  const map = new Map(Object.entries(items));
  return {
    get length() {
      return map.size;
    },
    key: index => [...map.keys()][index] ?? null,
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: key => map.delete(key),
    clear: () => {
      map.clear();
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('handoverItems', () => {
  it("takes the app's own items and leaves the page's working ones behind", () => {
    const items = handoverItems(
      storage({ 'maxmix.people': '[]', 'maxmix.deviceId': 'abc', 'maxmix.pkce': 'x', other: 'y' })
    );
    expect(items).toEqual({ 'maxmix.people': '[]', 'maxmix.deviceId': 'abc' });
  });
});

describe('isLocalCopy', () => {
  it('is the copy on the kiosk service only', () => {
    expect(isLocalCopy('http://127.0.0.1:7341')).toBe(true);
    expect(isLocalCopy('https://the-max-mix.countdown.build')).toBe(false);
  });
});

describe('takeHandover', () => {
  it('does nothing outside the local copy', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await takeHandover(storage({}));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('takes the items once, keeping its own, and has them deleted', async () => {
    vi.stubGlobal('location', { origin: 'http://127.0.0.1:7341' });
    const fetchSpy = vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith('/handover')
          ? new Response(JSON.stringify({ items: { 'maxmix.people': '[1]', 'maxmix.kiosk': 'false' } }))
          : new Response(null, { status: 204 })
      )
    );
    vi.stubGlobal('fetch', fetchSpy);
    const local = storage({ 'maxmix.kiosk': 'true' });
    await takeHandover(local);
    expect(local.getItem('maxmix.people')).toBe('[1]');
    expect(local.getItem('maxmix.kiosk')).toBe('true');
    expect(local.getItem(TAKEN_KEY)).toBe('1');
    expect(fetchSpy).toHaveBeenLastCalledWith('http://127.0.0.1:7341/handover/done', { method: 'POST' });
    await takeHandover(local);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('tries again next time when the service does not answer', async () => {
    vi.stubGlobal('location', { origin: 'http://127.0.0.1:7341' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('down')))
    );
    const local = storage({});
    await takeHandover(local);
    expect(local.getItem(TAKEN_KEY)).toBeNull();
  });
});
