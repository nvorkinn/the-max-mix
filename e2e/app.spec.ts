import { expect, test } from '@playwright/test';
import { fakeSpotify } from './fake-spotify.ts';

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

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

  test('does not restrict browser zoom', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
      'content',
      'width=device-width, initial-scale=1.0'
    );
  });
});
