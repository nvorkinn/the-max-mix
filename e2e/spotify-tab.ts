import { expect, type Page } from '@playwright/test';
/** Taps over to the Spotify tab. */
export async function showSpotifyTab(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Spotify' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Spotify' })).toBeVisible();
}

/** Opens the app at `url`, which starts on the Dashboard, and shows the Spotify tab. */
export async function openSpotifyTab(page: Page, url = '/'): Promise<void> {
  await page.goto(url);
  await showSpotifyTab(page);
}
