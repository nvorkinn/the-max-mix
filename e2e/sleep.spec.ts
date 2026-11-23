import { expect, test } from '@playwright/test';
import { advance } from './clock.ts';
import { countPlaybackReads, fakeSpotify, PIXEL } from './fake-spotify.ts';
import { showSection } from './settings.ts';
import { openSpotifyTab } from './spotify-tab.ts';

test.describe('Screen sleep', { tag: '@sleep' }, () => {
  // Midnight on the page's clock, which the quiet hours read in local time.
  test.use({ timezoneId: 'UTC' });
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
    );
    await page.route('http://127.0.0.1:7341/**', route => route.fulfill({ status: 204 }));
    await fakeSpotify(page);
    await page.addInitScript(() => {
      localStorage.setItem('maxmix.kiosk', 'true');
    });
    // The page's clock only moves when the test moves it, so the polling and the idle timer can be counted.
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
  });

  test('a sleeping screen reads Spotify seldom, and reads again at once when it wakes', async ({ page }) => {
    const reads = countPlaybackReads(page);
    await openSpotifyTab(page);
    // Music playing keeps the screen on, so it is paused (on the other device, which is still watched).
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

    // Awake and watching another device, it asks every few seconds.
    const before = reads();
    await advance(page, 20_000);
    expect(reads() - before).toBeGreaterThanOrEqual(3);

    // Quiet hours (22:00 to 07:00, and the page's clock says midnight) sleep the screen a minute after the last touch.
    await page.getByRole('tab', { name: 'Settings' }).click();
    const settings = page.getByRole('tabpanel', { name: 'Settings' });
    await showSection(settings, 'Screen');
    await settings.getByRole('switch', { name: 'Quiet hours' }).click();
    await expect(settings.getByRole('slider', { name: 'From' })).toBeVisible();
    await advance(page, 55_000, 5000);
    const awake = reads();
    await advance(page, 10_000, 5000);
    await expect(page.getByRole('button', { name: 'Wake the screen' })).toBeVisible();
    // Falling asleep reads once more (waited for, as a slow machine may take a moment), then it goes quiet.
    await advance(page, 1000);
    await expect.poll(reads).toBeGreaterThan(awake);
    const asleep = reads();
    await advance(page, 30_000, 5000);
    expect(reads()).toBe(asleep);
    await advance(page, 20_000);
    expect(reads() - asleep).toBeGreaterThanOrEqual(1);
    expect(reads() - asleep).toBeLessThanOrEqual(2);

    const quiet = reads();
    await page.getByRole('button', { name: 'Wake the screen' }).click();
    await expect.poll(reads).toBeGreaterThan(quiet);
  });

  test('with nothing playing the Dashboard comes up after a minute, dims five minutes later and sleeps the chosen time after that, never while music plays', async ({
    page
  }) => {
    await openSpotifyTab(page);
    await page.getByRole('tab', { name: 'Settings' }).click();
    const settings = page.getByRole('tabpanel', { name: 'Settings' });
    await showSection(settings, 'Screen');
    const choices = settings.getByRole('group', { name: 'Screen sleep' });
    await choices.getByRole('button', { name: '2 min', exact: true }).click();
    await expect(choices.getByRole('button', { name: '2 min', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('tab', { name: 'Spotify' }).click();

    const dimmed = page.getByRole('dialog', { name: 'Dimmed screen' });
    const asleep = page.getByRole('dialog', { name: 'Sleep screen' });
    const dashboard = page.getByRole('tab', { name: 'Dashboard' });
    // Music plays for nine minutes, longer than the minute to the Dashboard, five to dim and two to sleep put together.
    await advance(page, 9 * 60_000, 15_000);
    await expect(dimmed).toHaveCount(0);
    await expect(asleep).toHaveCount(0);
    await expect(dashboard).toHaveAttribute('aria-selected', 'false');

    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await advance(page, 50_000, 5000);
    await expect(dashboard).toHaveAttribute('aria-selected', 'false');
    await advance(page, 15_000, 5000);
    await expect(dashboard).toHaveAttribute('aria-selected', 'true');
    await advance(page, 270_000, 15_000);
    await expect(dimmed).toHaveCount(0);
    await advance(page, 40_000, 5000);
    await expect(dimmed).toBeVisible();
    await advance(page, 90_000, 15_000);
    await expect(asleep).toHaveCount(0);
    await advance(page, 30_000, 5000);
    await expect(asleep).toBeVisible();
  });

  test('Settings left alone give way to the Dashboard, which dims, and a tap brightens it without pressing what is behind', async ({
    page
  }) => {
    await openSpotifyTab(page);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByRole('tabpanel', { name: 'Settings' })).toBeVisible();

    // Nobody touches the screen, with nothing playing: a minute to the Dashboard, five more to dim it.
    await advance(page, 60_000 + 5000, 5000);
    await expect(page.getByRole('tabpanel', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('tabpanel', { name: 'Settings' })).toBeHidden();
    await advance(page, 5 * 60_000, 15_000);
    const dimmed = page.getByRole('dialog', { name: 'Dimmed screen' });
    await expect(dimmed).toBeVisible();
    // The overlay covers everything, so the tap that brightens the screen reaches nothing behind it: here the Settings tab.
    const settingsTab = page.getByRole('tab', { name: 'Settings' });
    const box = await settingsTab.boundingBox();
    if (!box) throw new Error('No Settings tab');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(dimmed).toHaveCount(0);
    await expect(page.getByRole('tabpanel', { name: 'Dashboard' })).toBeVisible();

    // Left alone again it dims, then sleeps after the default five minutes, and a tap wakes it to the Dashboard.
    await advance(page, 5 * 60_000 + 5000, 15_000);
    await expect(dimmed).toBeVisible();
    await advance(page, 5 * 60_000, 15_000);
    const asleep = page.getByRole('dialog', { name: 'Sleep screen' });
    await expect(asleep).toBeVisible();
    await page.mouse.click(512, 300);
    await expect(asleep).toHaveCount(0);
    await expect(page.getByRole('tabpanel', { name: 'Dashboard' })).toBeVisible();
  });

  test('in quiet hours the screen sleeps a minute after the last touch', async ({ page }) => {
    await openSpotifyTab(page);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Settings' }).click();
    const settings = page.getByRole('tabpanel', { name: 'Settings' });
    await showSection(settings, 'Screen');
    // Quiet hours start out 22:00 to 07:00, and the page's clock says midnight.
    await settings.getByRole('switch', { name: 'Quiet hours' }).click();
    await expect(settings.getByRole('slider', { name: 'From' })).toBeVisible();

    const asleep = page.getByRole('dialog', { name: 'Sleep screen' });
    await advance(page, 55_000, 5000);
    await expect(asleep).toHaveCount(0);
    await advance(page, 10_000, 5000);
    await expect(asleep).toBeVisible();
  });
});
