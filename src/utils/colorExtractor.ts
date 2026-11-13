/** An RGB colour, each channel 0 to 255. */
export type Rgb = readonly [number, number, number];

/**
 * Colours taken from the album art: the average of the top half and of the bottom half (the background tint), and the
 * cover's two dominant colours (the Dynamic colour choice), the most prominent first.
 */
export interface ArtColours {
  top: string;
  bottom: string;
  dominant: readonly [Rgb, Rgb];
}

const SIZE = 10;

/** Near-black and near-white pixels carry no colour of the cover's own, so they are left out. */
function usable(red: number, green: number, blue: number): boolean {
  const brightness = (red + green + blue) / 3;
  return brightness > 30 && brightness < 230;
}

/** Averages the pixels in rows [fromRow, toRow) that are neither near-black nor near-white. */
function averageRows(data: Uint8ClampedArray, fromRow: number, toRow: number): string | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let i = fromRow * SIZE * 4; i < Math.min(data.length, toRow * SIZE * 4); i += 4) {
    const red = data[i] ?? 0;
    const green = data[i + 1] ?? 0;
    const blue = data[i + 2] ?? 0;
    if (usable(red, green, blue)) {
      r += red;
      g += green;
      b += blue;
      count++;
    }
  }
  return count === 0 ? null : `rgb(${Math.round(r / count)} ${Math.round(g / count)} ${Math.round(b / count)})`;
}

function saturation([red, green, blue]: Rgb): number {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  return max === 0 ? 0 : (max - min) / max;
}

function distance(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Two colours count as different when they are at least this far apart (about 441 separates black from white). */
const DISTINCT = 60;

/**
 * The cover's two dominant colours. Pixels are grouped into coarse colour boxes (eight levels per channel); each box
 * scores by how many pixels it holds, with vivid boxes counting extra so a large grey area doesn't beat the colour that
 * defines the cover. The best box comes first and the best one clearly different from it second; a cover with a single
 * colour pairs it with itself. Expects at least one usable pixel.
 */
function dominantColours(data: Uint8ClampedArray): readonly [Rgb, Rgb] {
  const boxes = new Map<number, { r: number; g: number; b: number; count: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const red = data[i] ?? 0;
    const green = data[i + 1] ?? 0;
    const blue = data[i + 2] ?? 0;
    if (!usable(red, green, blue)) continue;
    const key = ((red >> 5) << 6) | ((green >> 5) << 3) | (blue >> 5);
    const box = boxes.get(key) ?? { r: 0, g: 0, b: 0, count: 0 };
    box.r += red;
    box.g += green;
    box.b += blue;
    box.count++;
    boxes.set(key, box);
  }
  const ranked = Array.from(boxes.values(), box => {
    const colour: Rgb = [Math.round(box.r / box.count), Math.round(box.g / box.count), Math.round(box.b / box.count)];
    return { colour, score: box.count * (0.4 + saturation(colour)) };
  }).toSorted((a, b) => b.score - a.score);
  const first: Rgb = ranked[0]?.colour ?? [0, 0, 0];
  const second = ranked.find(entry => distance(entry.colour, first) >= DISTINCT)?.colour ?? first;
  return [first, second];
}

/**
 * Reads the colours from the album art through a tiny offscreen canvas. Returns null when there is no art, it fails to
 * load or can't be read (no CORS header), or it is all black and white, so the page then shows no tint at all.
 */
export async function extractArtColours(imageUrl?: string | null): Promise<ArtColours | null> {
  if (!imageUrl) return null;

  return new Promise<ArtColours | null>(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = imageUrl;

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('No 2d canvas context');
        canvas.width = SIZE;
        canvas.height = SIZE;
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        const data = ctx.getImageData(0, 0, SIZE, SIZE).data;

        const whole = averageRows(data, 0, SIZE);
        if (!whole) {
          resolve(null);
          return;
        }
        // A half with only black or white falls back to the whole cover's colour.
        resolve({
          top: averageRows(data, 0, SIZE / 2) ?? whole,
          bottom: averageRows(data, SIZE / 2, SIZE) ?? whole,
          dominant: dominantColours(data)
        });
      } catch {
        resolve(null);
      }
    };

    img.onerror = () => {
      resolve(null);
    };
  });
}
