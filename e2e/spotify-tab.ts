import { expect, type Page } from '@playwright/test';
import { runningFades } from './crossfade.ts';

/** Taps over to the Spotify tab and waits for the fade to end, so the player takes taps where it is drawn. */
export async function showSpotifyTab(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Spotify' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Spotify' })).toBeVisible();
  await expect.poll(() => runningFades(page)).toEqual([]);
}

/** Opens the app at `url`, which starts on the Dashboard, and shows the Spotify tab. */
export async function openSpotifyTab(page: Page, url = '/'): Promise<void> {
  await page.goto(url);
  await showSpotifyTab(page);
}
