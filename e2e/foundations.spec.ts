import { expect, test, type Locator, type Page } from '@playwright/test';

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

test.beforeEach(async ({ page }) => {
  await page.route('https://images.unsplash.com/**', route =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
  );
});

async function expectTouchTargets(scope: Locator) {
  const targets = await scope.locator('button:visible, input[type="range"]:visible, a:visible').evaluateAll(elements =>
    elements.map(element => {
      const rect = element.getBoundingClientRect();
      return {
        label: element.getAttribute('aria-label') || element.textContent,
        width: rect.width,
        height: rect.height
      };
    })
  );
  expect(targets.length).toBeGreaterThan(0);
  for (const target of targets) {
    expect(target.width, `${target.label}: width`).toBeGreaterThanOrEqual(44);
    expect(target.height, `${target.label}: height`).toBeGreaterThanOrEqual(44);
  }
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(
    await page
      .getByRole('dialog')
      .evaluateAll(dialogs => dialogs.every(dialog => dialog.scrollWidth <= dialog.clientWidth))
  ).toBe(true);
}

for (const viewport of [{ width: 1024, height: 600 }]) {
  test(`touch targets and dialogs fit ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/?demo=true&kiosk=1');
    await expect(page.getByRole('heading', { name: 'One More Time' })).toBeVisible();
    await expectTouchTargets(page.locator('body'));
    await expectNoHorizontalOverflow(page);

    const transport = page.getByRole('button', { name: 'Pause', exact: true });
    await expect(transport).toBeInViewport();

    await page.getByRole('button', { name: 'Open settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await expect(settings).toBeVisible();
    await expectTouchTargets(settings);
    await expectNoHorizontalOverflow(page);
    await settings.getByRole('button', { name: /Paper Light/ }).click();
    await expect(settings.getByRole('status')).toHaveText('Appearance updated to Paper');
    await expectTouchTargets(settings);
    await expectNoHorizontalOverflow(page);
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();

    await page.getByRole('button', { name: 'Choose a Spotify Connect device' }).click();
    const speakers = page.getByRole('dialog', { name: 'Choose a Spotify device' });
    await expect(speakers.getByRole('button', { name: /Demo tablet/ })).toBeVisible();
    await expectTouchTargets(speakers);
    await expectNoHorizontalOverflow(page);
    await speakers.getByRole('button', { name: 'Close speakers' }).click();
    await expect(speakers).toBeHidden();
  });
}

test('settings contain keyboard focus, wrap both ways and restore the trigger', async ({ page }) => {
  await page.goto('/?demo=true');
  const trigger = page.getByRole('button', { name: 'Open settings' });
  await trigger.click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  const close = settings.getByRole('button', { name: 'Close settings' });
  const last = settings.getByRole('button', { name: /Paper/ });
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
});

test('speakers wrap focus after devices load and restore focus on close', async ({ page }) => {
  await page.goto('/?demo=true');
  const trigger = page.getByRole('button', { name: 'Choose a Spotify Connect device' });
  await trigger.click();
  const speakers = page.getByRole('dialog', { name: 'Choose a Spotify device' });
  const device = speakers.getByRole('button', { name: /Demo tablet/ });
  await expect(device).toBeVisible();
  await device.focus();
  await page.keyboard.press('Tab');
  await expect(speakers.getByRole('button', { name: 'Refresh devices' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(device).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(speakers).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('Escape dismisses only the topmost dialog and restores the underlying focus', async ({ page }) => {
  await page.goto('/?demo=true');
  await page.getByRole('button', { name: 'Open settings' }).click();
  const studio = page.getByRole('button', { name: /Studio Signature/ });
  await studio.focus();
  await page.keyboard.press('Control+Shift+D');
  const debug = page.getByRole('dialog', { name: 'Debug console' });
  await expect(debug).toBeVisible();
  await expect(debug.getByRole('button', { name: 'Close debug console' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(debug).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await expect(studio).toBeFocused();
});

test('failed images become local artwork and initials rather than retrying URLs', async ({ page }) => {
  await page.route('https://images.unsplash.com/**', route => route.abort());
  await page.route('**/divas/**', route => route.abort());
  await page.goto('/?demo=true');
  await expect(page.locator('.album-cover.image-placeholder')).toBeVisible();
  await expect(page.locator('.queue-art.image-placeholder')).toHaveCount(4);
  await expect(page.locator('.guest-avatar.image-placeholder')).toHaveCount(5);
  await expect(page.locator('.track-credit .guest-avatar')).toHaveText('S');

  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: /Paper Light/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.guest-avatar.image-placeholder')).toHaveCount(5);
  await expect(page.locator('img.guest-avatar')).toHaveCount(0);
  await expect(page.locator('.album-cover.image-placeholder')).toBeVisible();

  await page.unroute('https://images.unsplash.com/**');
  await page.route('https://images.unsplash.com/**', route =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
  );
  await page.getByRole('button', { name: 'Next track' }).click();
  await expect(page.getByRole('heading', { name: 'Starboy' }).first()).toBeVisible();
  await expect(page.locator('img.album-cover')).toBeVisible();
});

test('the viewport does not restrict browser zoom', async ({ page }) => {
  await page.goto('/?demo=true');
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    'content',
    'width=device-width, initial-scale=1.0'
  );
});
