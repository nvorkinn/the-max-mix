import { expect, test, type Page } from '@playwright/test';
import { fakeSpotify, PIXEL } from './fake-spotify.ts';

test.beforeEach(async ({ page }) => {
  await page.route('https://images.unsplash.com/**', route =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
  );
  await fakeSpotify(page);
});

const nowPlaying = (page: Page) => page.getByRole('region', { name: 'Now playing' });
const upcoming = (page: Page) => page.getByRole('region', { name: 'Upcoming tracks' });

test.describe('Queue', { tag: '@queue' }, () => {
  test('tapping a queued song plays it and drops the songs before it from the queue', async ({ page }) => {
    await page.goto('/');
    await upcoming(page).getByRole('button', { name: 'Play Music Sounds Better with You by Stardust' }).click();
    await expect(nowPlaying(page)).toContainText('Music Sounds Better with You');
    await expect(upcoming(page)).not.toContainText('Starboy');
    await expect(upcoming(page)).not.toContainText('Levitating');
    await expect(upcoming(page)).toContainText('Midnight City');
  });
});
