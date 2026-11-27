import { vi } from 'vitest';
import type { Mock } from 'vitest';

/** jsdom has no canvas; install a recording 2d-context stub and a controllable rAF. */
export function installCanvasStub() {
  /** The recording context: every method is a mock, and plain properties hold whatever the component assigned. */
  type StubContext = Record<string, Mock> & {
    clearRect: Mock;
    fill: Mock;
    fillText: Mock;
    stroke: Mock;
    lineWidth: number;
    strokeStyle: string;
  };
  const store: Record<string | symbol, unknown> = {};
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
  }) as unknown as StubContext;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D); // partial 2d context stub

  let frames: { id: number; fn: FrameRequestCallback }[] = [];
  let nextId = 1;
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    frames.push({ id: nextId, fn });
    return nextId++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames = frames.filter(f => f.id !== id);
  });

  return {
    ctx,
    pending: () => frames.length,
    /** Run all currently queued frames once. */
    step() {
      const run = frames;
      frames = [];
      for (const f of run) f.fn(0);
    }
  };
}
