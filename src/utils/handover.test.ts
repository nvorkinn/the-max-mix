import { afterEach, describe, expect, it, vi } from 'vitest';
import { handoverItems, isLocalCopy, startHandover, TAKEN_KEY, takeHandover } from './handover';

const LOCAL = 'http://127.0.0.1:7341';

function storage(items: Record<string, string>): Storage {
  const map = new Map(Object.entries(items));
  const keyAt = (index: number): string | null => {
    let position = 0;
    for (const key of map.keys()) {
      if (position === index) return key;
      position += 1;
    }
    return null;
  };
  return {
    get length() {
      return map.size;
    },
    key: keyAt,
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
  vi.useRealTimers();
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
    const fetchSpy = vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith('/handover')
          ? Response.json({ items: { 'maxmix.people': '[1]', 'maxmix.kiosk': 'false' } })
          : new Response(null, { status: 204 })
      )
    );
    vi.stubGlobal('fetch', fetchSpy);
    const local = storage({ 'maxmix.kiosk': 'true' });
    await takeHandover(local, LOCAL);
    expect(local.getItem('maxmix.people')).toBe('[1]');
    expect(local.getItem('maxmix.kiosk')).toBe('true');
    expect(local.getItem(TAKEN_KEY)).toBe('1');
    expect(fetchSpy).toHaveBeenLastCalledWith('http://127.0.0.1:7341/handover/done', { method: 'POST' });
    await takeHandover(local, LOCAL);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('tries again next time when the service does not answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('down')))
    );
    const local = storage({});
    await takeHandover(local, LOCAL);
    expect(local.getItem(TAKEN_KEY)).toBeNull();
  });
});

describe('startHandover', () => {
  it('hands the items to the kiosk service now and every ten minutes', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchSpy);
    startHandover(storage({ 'maxmix.deviceId': 'abc' }));
    expect(fetchSpy).toHaveBeenCalledWith('http://127.0.0.1:7341/handover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: { 'maxmix.deviceId': 'abc' } })
    });
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('carries on when the service does not answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('down')))
    );
    vi.useFakeTimers();
    expect(() => {
      startHandover(storage({}));
    }).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
  });
});

describe('takeHandover with nothing handed over', () => {
  it('notes that there was none, and asks again after an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 404 })))
    );
    const empty = storage({});
    await takeHandover(empty, LOCAL);
    expect(empty.getItem(TAKEN_KEY)).toBe('1');

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 503 })))
    );
    const failing = storage({});
    await takeHandover(failing, LOCAL);
    expect(failing.getItem(TAKEN_KEY)).toBeNull();
  });
});
