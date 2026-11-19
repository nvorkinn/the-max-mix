import { expect, test } from '@playwright/test';
import { dashboardConfig, fakeCountdownServer, fakeFeed } from './fake-countdown.ts';
import { fakeSpotify, PIXEL } from './fake-spotify.ts';
import { openSpotifyTab } from './spotify-tab.ts';

test.describe('Changing tab', { tag: '@layout' }, () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
    );
    await fakeSpotify(page);
    // An owned kiosk's live feed, so the Dashboard has its boards.
    await fakeCountdownServer(page, dashboardConfig());
    await fakeFeed(page, new Date());
    await openSpotifyTab(page);
    await expect(page.getByRole('tab', { name: 'Spotify' })).toHaveAttribute('aria-selected', 'true');
  });

  test('rapid taps between the tabs end on the last one tapped', async ({ page }) => {
    // One tap every 40 ms. Only the tab bar showing takes each tap.
    await page.evaluate(async () => {
      const names = ['Dashboard', 'Settings', 'Spotify', 'Dashboard', 'Spotify', 'Settings', 'Dashboard'];
      for (const name of names) {
        const bar = [...globalThis.document.querySelectorAll<HTMLElement>('[role="tab"]')];
        bar.find(tab => tab.textContent === name && tab.offsetParent !== null)?.click();
        // eslint-disable-next-line no-await-in-loop -- one tap after the other
        await new Promise(resolve => setTimeout(resolve, 40));
      }
    });
    await expect(page.getByRole('tabpanel', { name: 'Dashboard' })).toBeVisible();
    // Still takes taps afterwards.
    await page.getByRole('tab', { name: 'Spotify' }).click();
    await expect(page.getByRole('tabpanel', { name: 'Spotify' })).toBeVisible();
  });

  test('the Dashboard stays mounted while another tab shows', async ({ page }) => {
    await page.getByRole('tab', { name: 'Dashboard' }).click();
    await expect(page.getByRole('region', { name: /^TfL / }).first()).toBeVisible();
    await page.getByRole('tab', { name: 'Spotify' }).click();
    await expect(page.getByRole('region', { name: /^TfL /, includeHidden: true }).first()).toBeAttached();
  });
});
