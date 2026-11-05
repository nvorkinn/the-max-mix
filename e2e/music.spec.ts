import { expect, test, type Page } from '@playwright/test';
import { fakeSpotify, PIXEL } from './fake-spotify.ts';

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

test.describe('Search for music', { tag: '@music' }, () => {
  test('plays a song found by searching, carrying on with its album', async ({ page }) => {
    const dialog = await openPicker(page);
    await dialog.getByRole('button', { name: 'Search' }).click();
    const field = dialog.getByRole('searchbox', { name: 'Search Spotify' });
    await expect(field).toBeFocused();
    await field.fill('star');
    const results = dialog.getByRole('list', { name: 'Search results' });
    await expect(results.getByRole('button')).toHaveText([/Starboy.*Song · The Weeknd, Daft Punk/]);
    await results.getByRole('button', { name: /Starboy/ }).click();
    await expect(dialog).toBeHidden();
    await expect(nowPlaying(page)).toContainText('First of spotify:album:queue-1');
  });

  test('says when nothing is found', async ({ page }) => {
    const dialog = await openPicker(page);
    await dialog.getByRole('button', { name: 'Search' }).click();
    await dialog.getByRole('searchbox', { name: 'Search Spotify' }).fill('zzz');
    await expect(dialog).toContainText('Nothing found.');
  });

  test('types with the on-screen keyboard on the kiosk', async ({ page }) => {
    await page.route('http://127.0.0.1:7341/**', route => route.fulfill({ status: 204 }));
    await page.addInitScript(() => {
      localStorage.setItem('maxmix.kiosk', 'true');
    });
    const dialog = await openPicker(page);
    await dialog.getByRole('button', { name: 'Search' }).click();
    const keyboard = dialog.getByRole('group', { name: 'On-screen keyboard' });
    await expect(keyboard).toBeVisible();
    await keyboard.getByRole('button', { name: 'd', exact: true }).click();
    await keyboard.getByRole('button', { name: 'e', exact: true }).click();
    await keyboard.getByRole('button', { name: 'e', exact: true }).click();
    await keyboard.getByRole('button', { name: 'p', exact: true }).click();
    await expect(dialog.getByRole('searchbox', { name: 'Search Spotify' })).toHaveValue('deep');
    const results = dialog.getByRole('list', { name: 'Search results' });
    await expect(results.getByRole('button')).toHaveText([/Deep Focus.*Playlist · By Spotify/]);
    // The dialog sits above the keyboard, so nothing found is hidden under it.
    const dialogBox = await dialog.boundingBox();
    const keyboardBox = await keyboard.boundingBox();
    expect((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0)).toBeLessThanOrEqual(keyboardBox?.y ?? 0);
    await keyboard.getByRole('button', { name: 'Done' }).click();
    await expect(keyboard).toBeHidden();
    await results.getByRole('button', { name: /Deep Focus/ }).click();
    await expect(nowPlaying(page)).toContainText('First of spotify:playlist:focus');
  });
});
