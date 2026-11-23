import { expect, test, type Locator } from '@playwright/test';
import { showDashboard } from './dashboard.ts';

// While a song plays, the Dashboard shows it in a card under the clock, clear of the weather, with pause and skip
// working the player. A pause leaves the card there to play the song again.

const SCREENS = [
  { width: 1280, height: 800 },
  { width: 1024, height: 600 }
] as const;

const box = async (locator: Locator) => {
  const found = await locator.boundingBox();
  if (!found) throw new Error('not on screen');
  return found;
};

for (const screen of SCREENS) {
  test(
    `the song playing sits under the clock at ${screen.width}x${screen.height}`,
    { tag: '@layout' },
    async ({ page }) => {
      await showDashboard(page, screen);
      const dashboard = page.getByRole('tabpanel', { name: 'Dashboard' });
      const card = dashboard.getByRole('region', { name: 'Now playing' });
      await expect(card).toContainText('One More Time');
      await expect(card).toContainText('Daft Punk');

      const clock = await box(dashboard.locator('.dashboard-clock'));
      const shown = await box(card);
      // Under the clock, lined up with its right edge, on the screen and in the band of plain sky along the top of the
      // backdrop (its top fifth), and clear of the weather on the left.
      expect(shown.y).toBeGreaterThan(clock.y + clock.height);
      expect(Math.abs(shown.x + shown.width - (clock.x + clock.width))).toBeLessThan(1);
      expect(shown.x + shown.width).toBeLessThanOrEqual(screen.width);
      expect(shown.y + shown.height).toBeLessThanOrEqual(screen.height / 5);
      const weather = await box(dashboard.locator('.dashboard-weather'));
      expect(shown.x).toBeGreaterThan(weather.x + weather.width);
      await expect(card.getByRole('button', { name: 'Previous' })).toHaveCount(0);
      // The buttons stay big enough to tap on the small screen too.
      const pause = await box(card.getByRole('button', { name: 'Pause' }));
      expect(pause.width).toBeGreaterThanOrEqual(36);
    }
  );
}

test('the card works the player and stays after a pause', async ({ page }) => {
  const spotify = await showDashboard(page, SCREENS[0]);
  const card = page.getByRole('tabpanel', { name: 'Dashboard' }).getByRole('region', { name: 'Now playing' });

  await card.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(() => spotify.commands).toContain('PUT /v1/me/player/pause');
  await expect(card.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

  await card.getByRole('button', { name: 'Next' }).click();
  await expect.poll(() => spotify.commands.some(command => command.startsWith('POST /v1/me/player/next'))).toBe(true);
});
