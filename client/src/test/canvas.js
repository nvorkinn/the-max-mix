import { vi } from 'vitest';

/** jsdom has no canvas; install a recording 2d-context stub and a controllable rAF. */
export function installCanvasStub() {
  /** @type {Record<string | symbol, any>} */
  const store = {};
  const ctx = new Proxy(store, {
    get(target, prop) {
      if (prop === 'createLinearGradient') return () => ({ addColorStop: vi.fn() });
      if (!(prop in target)) target[prop] = vi.fn();
      return target[prop];
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    }
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(/** @type {any} */ (ctx)); // partial 2d context stub

  /** @type {{ id: number, fn: FrameRequestCallback }[]} */
  let frames = [];
  let nextId = 1;
  vi.stubGlobal('requestAnimationFrame', (/** @type {FrameRequestCallback} */ fn) => {
    frames.push({ id: nextId, fn });
    return nextId++;
  });
  vi.stubGlobal('cancelAnimationFrame', (/** @type {number} */ id) => {
    frames = frames.filter(f => f.id !== id);
  });

  return {
    ctx,
    pending: () => frames.length,
    /** Run all currently queued frames once. */
    step() {
      const run = frames;
      frames = [];
      run.forEach(f => f.fn(0));
    }
  };
}

export function stubMatchMedia(matches = false) {
  const listeners = new Set();
  const mql = {
    matches,
    addEventListener: (/** @type {string} */ _, /** @type {Function} */ fn) => listeners.add(fn),
    removeEventListener: (/** @type {string} */ _, /** @type {Function} */ fn) => listeners.delete(fn),
    listeners
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mql)
  );
  return mql;
}
