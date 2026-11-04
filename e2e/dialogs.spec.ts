import { expect, test } from '@playwright/test';
import { fakeSpotify } from './fake-spotify.ts';

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

test.beforeEach(async ({ page }) => {
  await page.route('https://images.unsplash.com/**', route =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
  );
  await fakeSpotify(page);
});

// Keyboard focus and dismissal of the dialogs (settings, speakers drawer, debug console), each tagged with what it opens.
test.describe('Dialogs: focus and dismissal', { tag: '@dialogs' }, () => {
  test(
    'Settings keep keyboard focus inside, wrapping both ways, and give it back to the button',
    { tag: '@settings' },
    async ({ page }) => {
      await page.goto('/');
      const trigger = page.getByRole('button', { name: 'Open settings' });
      await trigger.click();
      const settings = page.getByRole('dialog', { name: 'Settings' });
      const close = settings.getByRole('button', { name: 'Close settings' });
      const last = settings.getByRole('button').last();
      await expect(close).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(last).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(close).toBeFocused();

      await trigger.focus();
      await expect(close).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(settings).toBeHidden();
      await expect(trigger).toBeFocused();
    }
  );

  test(
    'the Speakers drawer takes focus when opened and gives it back on Escape',
    { tag: '@speakers' },
    async ({ page }) => {
      await page.goto('/');
      const trigger = page.getByRole('button', { name: /^Speakers:/ });
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await trigger.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      const speakers = page.getByRole('dialog', { name: 'Speakers' });
      await expect(speakers.getByRole('button', { name: /Test speaker/ })).toBeVisible();
      await expect(speakers.getByRole('button', { name: 'Close speakers' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(speakers).toBeHidden();
      await expect(trigger).toBeFocused();
    }
  );

  test('tapping outside the Speakers drawer closes it', { tag: '@speakers' }, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /^Speakers:/ }).click();
    const speakers = page.getByRole('dialog', { name: 'Speakers' });
    await expect(speakers).toBeVisible();
    await page.mouse.click(900, 300);
    await expect(speakers).toBeHidden();
  });

  test(
    'Escape closes only the topmost dialog (Debug console over Settings) and restores focus',
    { tag: ['@settings', '@debug'] },
    async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button', { name: 'Open settings' }).click();
      const wifi = page.getByRole('dialog', { name: 'Settings' }).getByRole('button').last();
      await wifi.focus();
      await page.keyboard.press('Control+Shift+D');
      const debug = page.getByRole('dialog', { name: 'Debug console' });
      await expect(debug).toBeVisible();
      await expect(debug.getByRole('button', { name: 'Close debug console' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(debug).toBeHidden();
      await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
      await expect(wifi).toBeFocused();
    }
  );
});
