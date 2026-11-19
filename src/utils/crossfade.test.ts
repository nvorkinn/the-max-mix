import { afterEach, describe, expect, it, vi } from 'vitest';
import { crossfade } from './crossfade';

const askForLessMotion = (reduce: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce') }));

describe('crossfade', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, 'startViewTransition');
  });

  it('runs the change as a view transition', () => {
    askForLessMotion(false);
    const start = vi.fn((callback: () => void) => callback());
    Object.assign(document, { startViewTransition: start });
    const update = vi.fn();
    crossfade(update);
    expect(start).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
  });

  it('changes at once, with no fade, when less motion is asked for (as in the e2e tests)', () => {
    askForLessMotion(true);
    const start = vi.fn();
    Object.assign(document, { startViewTransition: start });
    const update = vi.fn();
    crossfade(update);
    expect(start).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledOnce();
  });

  it('changes at once where the browser has no view transitions', () => {
    askForLessMotion(false);
    const update = vi.fn();
    crossfade(update);
    expect(update).toHaveBeenCalledOnce();
  });
});
