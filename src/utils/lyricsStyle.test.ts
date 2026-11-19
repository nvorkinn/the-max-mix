import { afterEach, describe, expect, it, vi } from 'vitest';

const KEY = 'maxmix.lyricsStyle';

/** A fresh copy of the module, so it reads storage again. */
const fresh = async () => {
  vi.resetModules();
  return import('./lyricsStyle');
};

afterEach(() => localStorage.clear());

describe('lyricsStyle', () => {
  it('defaults to the panel’s own size, lined up left', async () => {
    const { getLyricsStyle } = await fresh();
    expect(getLyricsStyle()).toEqual({ size: 'medium', align: 'left' });
  });

  it('keeps a change, tells listeners, and forgets it again once back at the default', async () => {
    const { getLyricsStyle, setLyricsStyle, subscribeLyricsStyle } = await fresh();
    const listener = vi.fn();
    const unsubscribe = subscribeLyricsStyle(listener);
    setLyricsStyle({ align: 'right' });
    setLyricsStyle({ size: 'large' });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(JSON.parse(localStorage.getItem(KEY) ?? '')).toEqual({ size: 'large', align: 'right' });
    const reloaded = await fresh();
    expect(reloaded.getLyricsStyle()).toEqual({ size: 'large', align: 'right' });

    setLyricsStyle({ size: 'medium', align: 'left' });
    expect(getLyricsStyle()).toEqual({ size: 'medium', align: 'left' });
    expect(localStorage.getItem(KEY)).toBeNull();
    unsubscribe();
  });

  it('ignores stored values it does not know', async () => {
    localStorage.setItem(KEY, JSON.stringify({ size: 'huge', align: 'center' }));
    const unknownSize = await fresh();
    expect(unknownSize.getLyricsStyle()).toEqual({ size: 'medium', align: 'center' });
    localStorage.setItem(KEY, 'not json');
    const broken = await fresh();
    expect(broken.getLyricsStyle()).toEqual({ size: 'medium', align: 'left' });
  });

  it('turns a size into the multiple of the panel’s own type size', async () => {
    const { lyricsScale } = await fresh();
    expect(lyricsScale('small')).toBeCloseTo(0.6);
    expect(lyricsScale('x-large')).toBeCloseTo(1);
  });
});
