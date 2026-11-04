import { expect, test } from '@playwright/test';
import { fakeSpotify } from './fake-spotify.ts';

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

test('artwork is square and the control bar stays on screen at 1024x600', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.route('https://images.unsplash.com/**', route =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
  );
  await fakeSpotify(page);
  await page.goto('/');
  const art = page.getByRole('button', { name: 'Show lyrics' });
  await expect(art).toBeVisible();
  const box = await art.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs((box?.width ?? 0) - (box?.height ?? 1))).toBeLessThanOrEqual(2);
  // The seek and volume sliders and the transport buttons all sit inside the viewport, under the artwork.
  const controls = [
    page.getByRole('slider', { name: 'Playback position' }),
    page.getByRole('slider', { name: 'Volume' }),
    page.getByRole('button', { name: 'Pause' })
  ];
  await Promise.all(controls.map(control => expect(control).toBeInViewport({ ratio: 1 })));
  const controlBoxes = await Promise.all(controls.map(control => control.boundingBox()));
  for (const controlBox of controlBoxes) {
    expect(controlBox?.y ?? 0).toBeGreaterThan((box?.y ?? 0) + (box?.height ?? 0));
  }
  expect(await page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});
