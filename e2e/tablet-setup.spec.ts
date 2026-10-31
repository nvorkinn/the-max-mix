import { expect, test } from '@playwright/test';

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

test.beforeEach(async ({ page }) => {
  await page.route('https://images.unsplash.com/**', route =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
  );
});

for (const appearance of ['neon', 'minimal']) {
  for (const viewport of [
    { width: 1024, height: 600 },
    { width: 768, height: 1024 }
  ]) {
    test(`tablet setup fits ${viewport.width}x${viewport.height} in ${appearance} and preserves saved preferences`, async ({
      page
    }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(theme => {
        /* eslint-disable n/no-unsupported-features/node-builtins -- This init script runs in the browser, not Node. */
        localStorage.setItem('maxmix_theme', theme);
        Object.defineProperty(navigator, 'requestMediaKeySystemAccess', { value: undefined, configurable: true });
        /* eslint-enable n/no-unsupported-features/node-builtins */
      }, appearance);
      const commands: string[] = [];
      await page.route('https://api.spotify.com/**', route => {
        commands.push(route.request().method());
        return route.fulfill({ status: 503 });
      });
      await page.goto('/');
      const setup = page.getByRole('region', { name: 'Now playing' });
      await expect(setup.getByRole('button', { name: 'Connect Spotify' })).toBeInViewport();
      await expect(setup.getByRole('button', { name: 'Try demo' })).toBeInViewport();
      await expect(setup.getByRole('slider')).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Upcoming tracks' })).toHaveCount(0);
      await setup.getByRole('button', { name: 'Connection settings' }).click();
      const settings = page.getByRole('dialog', { name: 'Settings' });
      await expect(settings.getByRole('button', { name: 'Log in with Spotify' })).toBeInViewport();
      await expect(settings.getByRole('radio', { name: 'This device' })).toBeDisabled();
      await expect(settings.getByText(/Unavailable: This browser has no encrypted media/)).toBeVisible();
      await expect(settings.getByRole('button', { name: 'Apply and reload' })).toBeDisabled();
      await settings.getByRole('radio', { name: 'Another Spotify device' }).click();
      await settings.getByRole('button', { name: 'Apply and reload' }).click();
      await expect(setup.getByRole('button', { name: 'Connect Spotify' })).toBeVisible();
      await setup.getByRole('button', { name: 'Connection settings' }).click();
      await expect(settings.getByRole('radio', { name: 'Another Spotify device' })).toBeChecked();
      await expect(settings.getByRole('button', { name: 'Apply and reload' })).toBeDisabled();
      await settings.getByRole('button', { name: 'Close settings' }).click();

      await setup.getByRole('button', { name: 'Try demo' }).click();
      await expect(page.locator('.app-footer')).toContainText('DEMO / simulated playback');
      await page.getByRole('button', { name: 'Open settings' }).click();
      await expect(settings.getByRole('radio', { name: 'Another Spotify device' })).toBeChecked();
      await settings.getByRole('switch', { name: 'Demo mode' }).click();
      await expect(page.locator('.app-footer')).toContainText('DEMO / simulated playback');
      await settings.getByRole('button', { name: 'Apply and reload' }).click();
      await expect(setup.getByRole('button', { name: 'Connect Spotify' })).toBeVisible();
      await expect(page.locator('.app-footer')).not.toContainText('simulated playback');
      expect(commands).toEqual([]);
      expect(await page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    });
  }
}

test('the primary Connect action goes directly to Spotify rather than through Settings', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.route('https://accounts.spotify.com/authorize**', route =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Test sign-in page</h1>' })
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect Spotify' }).click();
  await expect(page).toHaveURL(/^https:\/\/accounts\.spotify\.com\/authorize\?/);
  await expect(page.getByRole('heading', { name: 'Test sign-in page' })).toBeVisible();
});

test('failed sign-in retains recovery and diagnostics without automatically enabling demo', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto('/?error=access_denied');
  await expect(page.getByRole('alert')).toContainText(/Spotify|sign-in/i);
  await expect(page.getByRole('button', { name: 'Connect Spotify' })).toBeEnabled();
  await expect(page.locator('.app-footer')).not.toContainText('simulated playback');
  await page.getByRole('button', { name: 'Details' }).click();
  await expect(page.getByRole('dialog', { name: 'Debug console' })).toBeVisible();
});
