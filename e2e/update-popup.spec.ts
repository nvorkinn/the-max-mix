import { expect, test } from '@playwright/test';
import { fakeSpotify } from './fake-spotify.ts';

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

test('the update popup is on top of Settings, where it can be read and tapped', async ({ page }) => {
  await page.route('https://images.unsplash.com/**', route =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
  );
  await fakeSpotify(page);
  // The Pi runs v1.12.0 and GitHub first says that is the newest, so nothing is asked when the page starts.
  let newest = 'v1.12.0';
  await page.route('https://api.github.com/**', route => route.fulfill({ json: { tag_name: newest } }));
  await page.route('http://127.0.0.1:7341/**', route => route.fulfill({ status: 204 }));
  await page.addInitScript(() => {
    /* eslint-disable n/no-unsupported-features/node-builtins -- This init script runs in the browser, not Node. */
    localStorage.setItem('maxmix.kiosk', 'true');
    localStorage.setItem('maxmix.piVersion', 'v1.12.0 5a39e9a');
    /* eslint-enable n/no-unsupported-features/node-builtins */
  });
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeVisible();

  // A newer release comes out while the tablet runs; opening Settings again asks GitHub and finds it, with Settings open.
  newest = 'v1.13.0';
  await settings.getByRole('button', { name: 'Close settings' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  const popup = page.getByRole('dialog', { name: 'Update available' });
  await expect(popup).toBeVisible();
  await expect(settings).toBeVisible();

  // Whatever is at the popup's middle must be the popup (or part of it), not Settings behind it.
  const isOnTop = await popup.evaluate(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return element.contains(hit);
  });
  expect(isOnTop).toBe(true);
  await expect(popup.getByRole('button', { name: 'Not now' })).toBeInViewport({ ratio: 1 });

  // Playwright only clicks what receives the click, so this fails if Settings were over the popup.
  await popup.getByRole('button', { name: 'Not now' }).click();
  await expect(popup).toBeHidden();
  await expect(settings).toBeVisible();
});
