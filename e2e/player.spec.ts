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
const upcoming = (page: Page) => page.getByRole('region', { name: 'Upcoming tracks' });

test.describe('Player', { tag: '@player' }, () => {
  test('shows the playing track and what is queued next', { tag: '@queue' }, async ({ page }) => {
    await page.goto('/');
    await expect(nowPlaying(page)).toContainText('One More Time');
    await expect(nowPlaying(page)).toContainText('Daft Punk');
    await expect(upcoming(page)).toContainText('Starboy');
    await expect(upcoming(page)).toContainText('Levitating');
  });

  test('Pause and Play toggle playback', async ({ page }) => {
    await page.goto('/');
    await nowPlaying(page).getByRole('button', { name: 'Pause' }).click();
    await expect(nowPlaying(page).getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await expect(nowPlaying(page).getByRole('button', { name: 'Pause' })).toBeHidden();

    await nowPlaying(page).getByRole('button', { name: 'Play', exact: true }).click();
    await expect(nowPlaying(page).getByRole('button', { name: 'Pause' })).toBeVisible();
  });

  test('the 15 second buttons rewind and fast-forward the song', async ({ page }) => {
    await page.goto('/');
    const position = nowPlaying(page).getByRole('slider', { name: 'Playback position' });
    // The fake starts 45 s in and the clock keeps running, so the position is a second or two past the round number.
    await expect(position).toHaveAttribute('aria-valuetext', /^0:4[5-9] of /);
    await nowPlaying(page).getByRole('button', { name: 'Forward 15 seconds' }).click();
    await expect(position).toHaveAttribute('aria-valuetext', /^1:0\d of /);
    await nowPlaying(page).getByRole('button', { name: 'Back 15 seconds' }).click();
    await expect(position).toHaveAttribute('aria-valuetext', /^0:4\d of /);
  });

  test('Next and Previous change the track', { tag: '@queue' }, async ({ page }) => {
    await page.goto('/');
    await nowPlaying(page).getByRole('button', { name: 'Next track' }).click();
    await expect(nowPlaying(page)).toContainText('Starboy');
    await expect(upcoming(page)).not.toContainText('Starboy');

    await nowPlaying(page).getByRole('button', { name: 'Previous track' }).click();
    await expect(nowPlaying(page)).toContainText('One More Time');
    await expect(upcoming(page)).toContainText('Starboy');
  });

  test('failed images become local artwork rather than retrying URLs', { tag: '@queue' }, async ({ page }) => {
    await page.route('https://images.unsplash.com/**', route => route.abort());
    await page.goto('/');
    await expect(page.locator('.album-cover.image-placeholder')).toBeVisible();
    await expect(page.locator('.queue-art.image-placeholder')).toHaveCount(4);

    await page.getByRole('button', { name: 'Open settings' }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.album-cover.image-placeholder')).toBeVisible();

    await page.unroute('https://images.unsplash.com/**');
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
    );
    await page.getByRole('button', { name: 'Next track' }).click();
    await expect(page.getByRole('heading', { name: 'Starboy' }).first()).toBeVisible();
    await expect(page.locator('img.album-cover')).toBeVisible();
  });
});
