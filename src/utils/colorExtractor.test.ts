import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractArtColours } from './colorExtractor';

/** A 10x10 RGBA image: the top five rows one colour, the bottom five another. */
function halves(top: number[], bottom: number[]): number[] {
  return Array.from({ length: 100 }, (_, pixel) => [...(pixel < 50 ? top : bottom), 255]).flat();
}

let imageBehavior: 'load' | 'error' = 'load';

class FakeImage {
  onload: (() => void) | undefined;
  onerror: (() => void) | undefined;

  set src(_value: string) {
    queueMicrotask(() => {
      if (imageBehavior === 'error') this.onerror?.();
      else this.onload?.();
    });
  }
}

function stubCanvas(pixels: number[], { throws = false }: { throws?: boolean } = {}) {
  const ctx = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => {
      if (throws) throw new Error('tainted canvas');
      return { data: Uint8ClampedArray.from(pixels) };
    })
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D); // partial 2d context stub
  return ctx;
}

describe('extractArtColours', () => {
  beforeEach(() => {
    imageBehavior = 'load';
    vi.stubGlobal('Image', FakeImage);
  });

  it('returns null without an image url', async () => {
    expect(await extractArtColours()).toBeNull();
    expect(await extractArtColours('')).toBeNull();
  });

  it('returns null when the image fails to load', async () => {
    imageBehavior = 'error';
    expect(await extractArtColours('http://x/img.jpg')).toBeNull();
  });

  it('returns null when canvas reading throws', async () => {
    stubCanvas([], { throws: true });
    expect(await extractArtColours('http://x/img.jpg')).toBeNull();
  });

  it('returns null when every pixel is too dark or too bright', async () => {
    stubCanvas(halves([0, 0, 0], [255, 255, 255]));
    expect(await extractArtColours('http://x/img.jpg')).toBeNull();
  });

  it('averages the top and bottom halves separately', async () => {
    stubCanvas(halves([200, 40, 60], [30, 90, 160]));
    expect(await extractArtColours('http://x/img.jpg')).toEqual({ top: 'rgb(200 40 60)', bottom: 'rgb(30 90 160)' });
  });

  it('ignores near-black and near-white pixels in the average', async () => {
    const pixels = halves([80, 40, 140], [80, 40, 140]);
    pixels.splice(0, 8, 0, 0, 0, 255, 120, 60, 160, 255);
    stubCanvas(pixels);
    const colours = await extractArtColours('http://x/img.jpg');
    // 48 pixels of (80, 40, 140) and one of (120, 60, 160), the black one skipped.
    expect(colours?.top).toBe('rgb(81 40 140)');
  });

  it('uses the whole cover colour for a half that is only black or white', async () => {
    stubCanvas(halves([0, 0, 0], [30, 90, 160]));
    expect(await extractArtColours('http://x/img.jpg')).toEqual({ top: 'rgb(30 90 160)', bottom: 'rgb(30 90 160)' });
  });
});
