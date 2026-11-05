// TEMPORARY, do not merge: shows how a failed test is retried and filmed in CI.
import { expect, test } from '@playwright/test';
import { fakeSpotify, PIXEL } from './fake-spotify.ts';

test.beforeEach(async ({ page }) => {
  await page.route('https://images.unsplash.com/**', route =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
  );
  await fakeSpotify(page);
});

test.describe('Failure demo', { tag: '@app' }, () => {
  test('always fails, so both runs fail and the retry is filmed', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open settings' }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toContainText('This text is not there');
  });

  test('fails only on its first run, so it is flaky and still fails the job', async ({ page }, testInfo) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    expect(testInfo.retry, 'fails on purpose on the first run').toBe(1);
  });
});
