import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractPalette } from './colorExtractor.js';

const FALLBACK = {
  primary: 'rgba(29, 185, 84, 0.4)',
  secondary: 'rgba(125, 42, 232, 0.3)',
  dark: 'rgba(15, 17, 26, 0.95)'
};

let imageBehavior;

class FakeImage {
  /** @type {(() => void) | undefined} */
  onload;
  /** @type {(() => void) | undefined} */
  onerror;

  set src(value) {
    this._src = value;
    queueMicrotask(() => {
      if (imageBehavior === 'error') this.onerror?.();
      else this.onload?.();
    });
  }
}

function stubCanvas(pixels, { throws = false } = {}) {
  const ctx = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => {
      if (throws) throw new Error('tainted canvas');
      return { data: Uint8ClampedArray.from(pixels) };
    })
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(/** @type {any} */ (ctx)); // partial 2d context stub
  return ctx;
}

describe('extractPalette', () => {
  beforeEach(() => {
    imageBehavior = 'load';
    vi.stubGlobal('Image', FakeImage);
  });

  it('returns the fallback without an image url', async () => {
    expect(await extractPalette()).toEqual(FALLBACK);
    expect(await extractPalette('')).toEqual(FALLBACK);
  });

  it('returns the fallback when the image fails to load', async () => {
    imageBehavior = 'error';
    expect(await extractPalette('http://x/img.jpg')).toEqual(FALLBACK);
  });

  it('returns the fallback when canvas reading throws', async () => {
    stubCanvas([], { throws: true });
    expect(await extractPalette('http://x/img.jpg')).toEqual(FALLBACK);
  });

  it('returns the fallback when every pixel is too dark or too bright', async () => {
    stubCanvas([0, 0, 0, 255, 255, 255, 255, 255]);
    expect(await extractPalette('http://x/img.jpg')).toEqual(FALLBACK);
  });

  it('averages vibrant pixels and ignores extremes', async () => {
    // One black, one white (ignored), two mid tones averaged to (100, 50, 150).
    stubCanvas([0, 0, 0, 255, 255, 255, 255, 255, 80, 40, 140, 255, 120, 60, 160, 255]);
    const palette = await extractPalette('http://x/img.jpg');
    expect(palette.primary).toBe('rgba(100, 50, 150, 0.55)');
    // secondary: (b*1.2, r*0.7, g*1.3) = (180, 70, 65)
    expect(palette.secondary).toBe('rgba(180, 70, 65, 0.45)');
    expect(palette.dark).toBe('rgba(15, 7, 22, 0.95)');
  });

  it('clamps the secondary channels to 255', async () => {
    stubCanvas([100, 200, 220, 255]);
    const palette = await extractPalette('http://x/img.jpg');
    expect(palette.secondary).toBe('rgba(255, 70, 255, 0.45)');
  });
});
