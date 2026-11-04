import { expect, test, type Page } from '@playwright/test';
import { fakeSpotify } from './fake-spotify.ts';

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

test.beforeEach(async ({ page }) => {
  await page.route('https://images.unsplash.com/**', route =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
  );
  await fakeSpotify(page);
});

const nowPlaying = (page: Page) => page.getByRole('region', { name: 'Now playing' });

async function openPicker(page: Page) {
  await page.goto('/');
  await expect(nowPlaying(page)).toContainText('One More Time');
  await page.getByRole('button', { name: 'Choose music' }).click();
  const dialog = page.getByRole('dialog', { name: 'Choose music' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('Choose music', { tag: '@music' }, () => {
  test('plays a playlist chosen on the screen', async ({ page }) => {
    const dialog = await openPicker(page);
    const playlists = dialog.getByRole('list', { name: 'Playlists' });
    await expect(playlists.getByRole('button')).toHaveText(['Liked Songs', /Friday Mix/, /Deep Focus/]);
    await playlists.getByRole('button', { name: /Deep Focus/ }).click();
    await expect(dialog).toBeHidden();
    await expect(nowPlaying(page)).toContainText('First of spotify:playlist:focus');
  });

  test('plays Liked Songs', async ({ page }) => {
    const dialog = await openPicker(page);
    await dialog.getByRole('button', { name: 'Liked Songs' }).click();
    await expect(nowPlaying(page)).toContainText('First of spotify:user:max:collection');
  });

  test('plays a recently played track', async ({ page }) => {
    const dialog = await openPicker(page);
    await dialog.getByRole('button', { name: 'Recently played' }).click();
    await dialog
      .getByRole('list', { name: 'Recently played' })
      .getByRole('button', { name: /Blinding Lights/ })
      .click();
    await expect(dialog).toBeHidden();
    await expect(nowPlaying(page)).toContainText('Blinding Lights');
  });
});
