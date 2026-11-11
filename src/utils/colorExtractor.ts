/** Two colours taken from the album art: the average of the top half and of the bottom half. */
export interface ArtColours {
  top: string;
  bottom: string;
}

const SIZE = 10;

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
    const brightness = (red + green + blue) / 3;
    if (brightness > 30 && brightness < 230) {
      r += red;
      g += green;
      b += blue;
      count++;
    }
  }
  return count === 0 ? null : `rgb(${Math.round(r / count)} ${Math.round(g / count)} ${Math.round(b / count)})`;
}

/**
 * Reads two colours from the album art through a tiny offscreen canvas. Returns null when there is no art, it fails to
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
          bottom: averageRows(data, SIZE / 2, SIZE) ?? whole
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
