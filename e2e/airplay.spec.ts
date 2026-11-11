import { expect, test } from '@playwright/test';
import { fakeKioskAirPlay } from './fake-kiosk.ts';
import { fakeSpotify, PIXEL } from './fake-spotify.ts';

test.describe('AirPlay speakers', { tag: '@speakers' }, () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 600 });
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
    );
    await fakeSpotify(page);
  });

  test('each chosen speaker has a volume slider, shown on request, that sets its volume on the Pi', async ({
    page
  }) => {
    const sent = await fakeKioskAirPlay(page, { Kitchen: 40, Lounge: 70 }, ['Kitchen']);
    await page.goto('/');
    await page.getByRole('button', { name: /^Speakers:/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Speakers' });
    // Each speaker's own volume stays hidden until asked for, so nobody turns one up by mistake.
    await expect(dialog.getByRole('button', { name: /Kitchen/ })).toBeVisible();
    await expect(dialog.getByRole('slider', { name: 'Kitchen volume' })).toHaveCount(0);
    await dialog.getByRole('button', { name: "Show each speaker's volume" }).click();
    const kitchen = dialog.getByRole('slider', { name: 'Kitchen volume' });
    await expect(kitchen).toHaveValue('40');
    // Lounge is not chosen, so its volume does not matter yet.
    await expect(dialog.getByRole('slider', { name: 'Lounge volume' })).toHaveCount(0);
    await kitchen.fill('65');
    await expect.poll(() => sent.at(-1)).toEqual({ speaker: 'Kitchen', volume: 65 });
    await expect(kitchen).toHaveValue('65');
  });
});
