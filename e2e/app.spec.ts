import { expect, test } from '@playwright/test';
import { CONFIG, FEED } from './fake-countdown.ts';
import { fakeSpotify, PIXEL } from './fake-spotify.ts';

test.beforeEach(async ({ page }) => {
  await page.route('https://images.unsplash.com/**', route =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
  );
  await fakeSpotify(page);
});

test.describe('The app as a whole', { tag: '@app' }, () => {
  test('loads when signed in, with no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', message => {
      // The browser logs the fake countdown-server's 401s (config and live feed) for an unowned kiosk, which the app
      // takes in its stride.
      if (message.type() === 'error' && ![CONFIG, FEED].includes(message.location().url)) errors.push(message.text());
    });
    page.on('pageerror', error => {
      errors.push(error.message);
    });

    await page.goto('/');
    // Every start opens on the Dashboard, its tabs in the order Dashboard, Spotify, Player, Settings, Options.
    await expect(page.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab')).toHaveText(['Dashboard', 'Spotify', 'Player', 'Settings', 'Options']);
    await page.getByRole('tab', { name: 'Spotify' }).click();
    await expect(page.getByRole('button', { name: 'Speakers: Playing on Test speaker' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('does not restrict browser zoom', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
      'content',
      'width=device-width, initial-scale=1.0'
    );
  });
});
