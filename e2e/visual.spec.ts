import { expect, test, type Locator, type Page } from '@playwright/test';
import { fakeSpotify } from './fake-spotify.ts';

// Layout bugs such as an overlapping or gapped sticky modal header are invisible to the DOM assertions elsewhere, so
// these tests compare screenshots. Baselines are rendered by Chrome on ubuntu-latest, the only place they are
// reliable, so the tests run in CI or when E2E_VISUAL is set (and the baselines then come from a matching machine).
test.skip(!process.env['CI'] && !process.env['E2E_VISUAL'], 'Screenshots are only stable on the CI browser.');

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const SHOT = { animations: 'disabled', maxDiffPixelRatio: 0.002 } as const;

test.beforeEach(async ({ page }) => {
  // Short enough that the modals have to scroll, which is where the sticky header can go wrong.
  await page.setViewportSize({ width: 1024, height: 280 });
  await page.route('https://images.unsplash.com/**', route =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
  );
});

async function scrollToBottom(dialog: Locator) {
  await dialog.evaluate(element => {
    element.scrollTo({ top: element.scrollHeight });
  });
}

async function openSettings(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('settings modal at the top and scrolled', async ({ page }) => {
  const dialog = await openSettings(page);
  await expect(dialog).toHaveScreenshot('settings-top.png', SHOT);
  await scrollToBottom(dialog);
  await expect(dialog).toHaveScreenshot('settings-scrolled.png', SHOT);
});

test('speakers modal at the top and scrolled', async ({ page }) => {
  await fakeSpotify(page);
  await page.goto('/');
  await page.getByRole('button', { name: /^Choose (speakers|a Spotify Connect device)$/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Speakers' });
  await expect(dialog.getByRole('button', { name: /Test speaker/ })).toBeVisible();
  await expect(dialog).toHaveScreenshot('speakers-top.png', SHOT);
  await scrollToBottom(dialog);
  await expect(dialog).toHaveScreenshot('speakers-scrolled.png', SHOT);
});

test('signed-out setup screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Connect Spotify' })).toBeVisible();
  await expect(page).toHaveScreenshot('setup.png', SHOT);
});
