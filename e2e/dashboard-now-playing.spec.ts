import { expect, test, type Locator } from '@playwright/test';
import { showDashboard } from './dashboard.ts';

// While a song plays, the Dashboard shows it in a card hanging under the Spotify tab, wrapped round the Dashboard tab's
// pill with the same gap as between the tabs, with back, pause and skip working the player. A pause leaves the card there to play the song again.

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
    `the song playing hangs under the Spotify tab at ${screen.width}x${screen.height}`,
    { tag: '@layout' },
    async ({ page }) => {
      await showDashboard(page, screen);
      const dashboard = page.getByRole('tabpanel', { name: 'Dashboard' });
      const card = dashboard.getByRole('region', { name: 'Now playing' });
      await expect(card).toContainText('One More Time');
      await expect(card).toContainText('Daft Punk');

      const spotifyTab = await box(dashboard.getByRole('tab', { name: 'Spotify' }));
      const dashboardTab = await box(dashboard.getByRole('tab', { name: 'Dashboard' }));
      const shown = await box(card);
      // The tabs 5px apart (drawn smaller on the 7" screen), and the card lined up with the Spotify tab's left edge, the
      // same gap below the Dashboard tab, and on the screen.
      const gap = 5 * (screen.width / 1280);
      expect(dashboardTab.x - (spotifyTab.x + spotifyTab.width)).toBeCloseTo(gap, 0);
      expect(Math.abs(shown.x - spotifyTab.x)).toBeLessThan(1);
      expect(shown.y - (dashboardTab.y + dashboardTab.height)).toBeCloseTo(gap, 0);
      expect(shown.x + shown.width).toBeLessThanOrEqual(screen.width);
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
