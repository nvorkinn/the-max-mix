/**
 * Extracts ambient colors from album art image using an offscreen canvas
 */
export async function extractPalette(imageUrl) {
  const fallback = {
    primary: 'rgba(29, 185, 84, 0.4)', // Spotify green
    secondary: 'rgba(125, 42, 232, 0.3)',
    dark: 'rgba(15, 17, 26, 0.95)'
  };

  if (!imageUrl) return fallback;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = imageUrl;

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 10;
        canvas.height = 10;
        ctx.drawImage(img, 0, 0, 10, 10);
        
        const imageData = ctx.getImageData(0, 0, 10, 10).data;
        let r = 0, g = 0, b = 0, count = 0;

        for (let i = 0; i < imageData.length; i += 4) {
          // Ignore ultra-dark or ultra-white pixels to find vibrant tones
          const red = imageData[i];
          const green = imageData[i + 1];
          const blue = imageData[i + 2];
          const brightness = (red + green + blue) / 3;

          if (brightness > 30 && brightness < 230) {
            r += red;
            g += green;
            b += blue;
            count++;
          }
        }

        if (count === 0) {
          resolve(fallback);
          return;
        }

        r = Math.floor(r / count);
        g = Math.floor(g / count);
        b = Math.floor(b / count);

        // Generate secondary hue shift
        const sR = Math.min(255, Math.floor(b * 1.2));
        const sG = Math.floor(r * 0.7);
        const sB = Math.min(255, Math.floor(g * 1.3));

        resolve({
          primary: `rgba(${r}, ${g}, ${b}, 0.55)`,
          secondary: `rgba(${sR}, ${sG}, ${sB}, 0.45)`,
          dark: `rgba(${Math.floor(r * 0.15)}, ${Math.floor(g * 0.15)}, ${Math.floor(b * 0.15)}, 0.95)`
        });
      } catch (e) {
        resolve(fallback);
      }
    };

    img.onerror = () => {
      resolve(fallback);
    };
  });
}
