import { test, expect, type Page } from '@playwright/test';
import { fakeSpotify } from './fake-spotify.ts';

// Track art comes from a remote CDN; serve a 1x1 GIF instead so the run is offline-safe and deterministic.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

test.beforeEach(async ({ page }) => {
  await page.route('https://images.unsplash.com/**', route =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
  );
  await fakeSpotify(page);
});

const nowPlaying = (page: Page) => page.getByRole('region', { name: 'Now playing' });
const upcoming = (page: Page) => page.getByRole('region', { name: 'Upcoming tracks' });

test('loads signed in without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', error => {
    errors.push(error.message);
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /THE MAX MIX/ })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Playing on Test speaker' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('shows the current track and queue', async ({ page }) => {
  await page.goto('/');
  await expect(nowPlaying(page)).toContainText('One More Time');
  await expect(nowPlaying(page)).toContainText('Daft Punk');
  await expect(upcoming(page)).toContainText('Starboy');
  await expect(upcoming(page)).toContainText('Levitating');
});

test('pause and play toggle the playback state', async ({ page }) => {
  await page.goto('/');
  await nowPlaying(page).getByRole('button', { name: 'Pause' }).click();
  await expect(nowPlaying(page).getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(nowPlaying(page).getByRole('button', { name: 'Pause' })).toBeHidden();

  await nowPlaying(page).getByRole('button', { name: 'Play' }).click();
  await expect(nowPlaying(page).getByRole('button', { name: 'Pause' })).toBeVisible();
});

test('next and previous change the current track', async ({ page }) => {
  await page.goto('/');
  await nowPlaying(page).getByRole('button', { name: 'Next track' }).click();
  await expect(nowPlaying(page)).toContainText('Starboy');
  await expect(upcoming(page)).not.toContainText('Starboy');

  await nowPlaying(page).getByRole('button', { name: 'Previous track' }).click();
  await expect(nowPlaying(page)).toContainText('One More Time');
  await expect(upcoming(page)).toContainText('Starboy');
});

test('settings modal opens and closes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close settings' }).click();
  await expect(dialog).toBeHidden();
});
