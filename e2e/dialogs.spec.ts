import { expect, test } from '@playwright/test';
import { fakeSpotify, PIXEL } from './fake-spotify.ts';
import { openSpotifyTab } from './spotify-tab.ts';

test.beforeEach(async ({ page }) => {
  await page.route('https://images.unsplash.com/**', route =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
  );
  await fakeSpotify(page);
});

// Keyboard focus and dismissal of the dialogs (debug console), each tagged with what it opens.
test.describe('Dialogs: focus and dismissal', { tag: '@dialogs' }, () => {
  test(
    'Escape closes the Debug console over Settings and gives focus back',
    { tag: ['@settings', '@debug'] },
    async ({ page }) => {
      await openSpotifyTab(page);
      await page.getByRole('tab', { name: 'Settings' }).click();
      const wifi = page.getByRole('tabpanel', { name: 'Settings' }).getByRole('button').last();
      await wifi.focus();
      await page.keyboard.press('Control+Shift+D');
      const debug = page.getByRole('dialog', { name: 'Debug console' });
      await expect(debug).toBeVisible();
      await expect(debug.getByRole('button', { name: 'Close debug console' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(debug).toBeHidden();
      await expect(page.getByRole('tabpanel', { name: 'Settings' })).toBeVisible();
      await expect(wifi).toBeFocused();
    }
  );
});
