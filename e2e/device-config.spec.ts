import { expect, test } from '@playwright/test';
import { DEVICE_CONFIGS, fakeCountdownServer } from './fake-countdown.ts';
import { fakeSpotify, PIXEL } from './fake-spotify.ts';
import { openSettings } from './settings.ts';

test.describe("The kiosk's config from countdown-server", { tag: ['@registration', '@appearance'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
    );
    await fakeSpotify(page);
  });

  test("an owned kiosk takes the server's skin and colour, asking with its secret", async ({ page }) => {
    // Routes added later answer first, so this one stands in for fakeSpotify's.
    const server = await fakeCountdownServer(page, {
      ...DEVICE_CONFIGS.owned,
      style: { skin: 'night', colour: 'pink' }
    });
    await page.goto('/?kiosk=1');

    const room = page.locator('.tablet-container');
    await expect(room).toHaveAttribute('data-theme', 'night');
    await expect(room).toHaveAttribute('data-colour', 'pink');
    expect(server.authorizations).toEqual(['Bearer e2e-not-a-real-secret']);
  });

  test('an unowned kiosk keeps its own settings', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('maxmix.theme', 'night');
    });
    const server = await fakeCountdownServer(page, DEVICE_CONFIGS.pairing);
    await page.goto('/?kiosk=1');

    await expect.poll(() => server.authorizations.length).toBe(1);
    await expect(page.locator('.tablet-container')).toHaveAttribute('data-theme', 'night');
    await expect(page.locator('.tablet-container')).toHaveAttribute('data-colour', 'forest');
  });

  test('a change in the settings saves to the server at once, and shows Saved', async ({ page }) => {
    const server = await fakeCountdownServer(page, DEVICE_CONFIGS.owned);
    await page.goto('/?kiosk=1');
    const settings = await openSettings(page, 'Appearance');

    await settings.getByRole('button', { name: 'Night' }).click();
    await expect(page.locator('.tablet-container')).toHaveAttribute('data-theme', 'night');
    await expect(settings.getByText('Saved', { exact: true })).toBeVisible();
    expect(server.saves).toHaveLength(1);
    expect(server.saves[0]).toMatchObject({ device_id: '0a1b2c3d4e5f', style: { skin: 'night', colour: 'dynamic' } });
  });

  test('a quick run of changes saves only the last one', async ({ page }) => {
    const server = await fakeCountdownServer(page, DEVICE_CONFIGS.owned);
    await page.goto('/?kiosk=1');
    const settings = await openSettings(page, 'Screen sleep');

    await settings.getByRole('button', { name: '2 min' }).click();
    await settings.getByRole('button', { name: '30 min' }).click();
    await expect(settings.getByText('Saved', { exact: true })).toBeVisible();
    expect(server.saves.map(save => save['display'])).toEqual([{ sleep_minutes: 30 }]);
  });

  test("a change the server refuses is undone, and says it wasn't saved", async ({ page }) => {
    await fakeCountdownServer(page, DEVICE_CONFIGS.owned, { saveStatus: 500 });
    await page.goto('/?kiosk=1');
    const settings = await openSettings(page, 'Appearance');

    await settings.getByRole('button', { name: 'Night' }).click();
    await expect(settings.getByText('Not saved', { exact: true })).toBeVisible();
    await expect(page.locator('.tablet-container')).toHaveAttribute('data-theme', 'day');
  });
});
