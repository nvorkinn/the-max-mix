import { test, expect } from '@playwright/test';

// Demo mode is switched on per page with `?demo=true`; the simulated player runs in the browser, so no network is needed.
const DEMO_URL = '/?demo=true';

// Demo track art comes from a remote CDN; serve a 1x1 GIF instead so the run is offline-safe and deterministic.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

test.beforeEach(async ({ page }) => {
  await page.route('https://images.unsplash.com/**', route =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
  );
});

/** @param {import('@playwright/test').Page} page */
const nowPlaying = page => page.getByRole('region', { name: 'Now playing' });
/** @param {import('@playwright/test').Page} page */
const upcoming = page => page.getByRole('region', { name: 'Upcoming tracks' });

test('loads in demo mode without console errors', async ({ page }) => {
  /** @type {string[]} */
  const errors = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', error => {
    errors.push(error.message);
  });

  await page.goto(DEMO_URL);
  await expect(page.getByRole('heading', { name: /THE MAX MIX/ })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Demo session' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('shows the demo track and queue', async ({ page }) => {
  await page.goto(DEMO_URL);
  await expect(nowPlaying(page)).toContainText('One More Time');
  await expect(nowPlaying(page)).toContainText('Daft Punk');
  await expect(upcoming(page)).toContainText('Starboy');
  await expect(upcoming(page)).toContainText('Levitating');
});

test('pause and play toggle the playback state', async ({ page }) => {
  await page.goto(DEMO_URL);
  await nowPlaying(page).getByRole('button', { name: 'Pause' }).click();
  await expect(nowPlaying(page).getByRole('button', { name: 'Play' })).toBeVisible();
  await expect(nowPlaying(page).getByRole('button', { name: 'Pause' })).toBeHidden();

  await nowPlaying(page).getByRole('button', { name: 'Play' }).click();
  await expect(nowPlaying(page).getByRole('button', { name: 'Pause' })).toBeVisible();
});

test('next and previous change the current track', async ({ page }) => {
  await page.goto(DEMO_URL);
  await nowPlaying(page).getByRole('button', { name: 'Next track' }).click();
  await expect(nowPlaying(page)).toContainText('Starboy');
  await expect(upcoming(page)).not.toContainText('Starboy');

  await nowPlaying(page).getByRole('button', { name: 'Previous track' }).click();
  await expect(nowPlaying(page)).toContainText('One More Time');
  await expect(upcoming(page)).toContainText('Starboy');
});

test('settings modal opens and closes', async ({ page }) => {
  await page.goto(DEMO_URL);
  await page.getByRole('button', { name: 'Open settings and skins' }).click();
  const dialog = page.getByRole('dialog', { name: 'Make it yours' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close settings' }).click();
  await expect(dialog).toBeHidden();
});
