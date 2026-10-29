import { vi } from 'vitest';

/**
 * The recording context: every method is a mock, and plain properties hold whatever the component assigned.
 * @typedef {Record<string, import('vitest').Mock> & {
 *   clearRect: import('vitest').Mock,
 *   fill: import('vitest').Mock,
 *   fillText: import('vitest').Mock,
 *   stroke: import('vitest').Mock,
 *   lineWidth: number,
 *   strokeStyle: string
 * }} StubContext
 */

/** jsdom has no canvas; install a recording 2d-context stub and a controllable rAF. */
export function installCanvasStub() {
  /** @type {Record<string | symbol, unknown>} */
  const store = {};
  const ctx = /** @type {StubContext} */ (
    /** @type {unknown} */ (
      new Proxy(store, {
        get(target, prop) {
          if (prop === 'createLinearGradient') return () => ({ addColorStop: vi.fn() });
          if (!(prop in target)) target[prop] = vi.fn();
          return target[prop];
        },
        set(target, prop, value) {
          target[prop] = value;
          return true;
        }
      })
    )
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    /** @type {CanvasRenderingContext2D} */ (/** @type {unknown} */ (ctx))
  ); // partial 2d context stub

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
    addEventListener: (/** @type {string} */ _, /** @type {() => void} */ fn) => listeners.add(fn),
    removeEventListener: (/** @type {string} */ _, /** @type {() => void} */ fn) => listeners.delete(fn),
    listeners
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mql)
  );
  return mql;
}
