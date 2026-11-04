import { expect, test } from '@playwright/test';
import { fakeSpotify } from './fake-spotify.ts';

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

test.beforeEach(async ({ page }) => {
  await page.route('https://images.unsplash.com/**', route =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
  );
  await fakeSpotify(page);
});

test.describe('Settings', { tag: '@settings' }, () => {
  test('opens and closes', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close settings' }).click();
    await expect(dialog).toBeHidden();
  });
});
