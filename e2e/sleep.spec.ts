import { expect, test } from '@playwright/test';
import { advance } from './clock.ts';
import { countPlaybackReads, fakeSpotify, PIXEL } from './fake-spotify.ts';
import { showSection } from './settings.ts';

test.describe('Screen sleep', { tag: '@sleep' }, () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 600 });
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

  test('the sleep button blacks out the screen, even while music plays, until it is tapped', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    // The sleep button is in the Settings tab's header; the bar on the Spotify tab has none.
    await page.getByRole('tab', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Put the screen to sleep' }).click();

    const wake = page.getByRole('button', { name: 'Wake the screen' });
    await expect(wake).toBeVisible();
    // It covers the whole screen, so a tap on it cannot reach a button behind it.
    await expect(wake).toBeInViewport({ ratio: 1 });
    const box = await wake.boundingBox();
    expect(box).toMatchObject({ x: 0, y: 0, width: 1024, height: 600 });

    // Music is playing, and still the screen stays asleep.
    await advance(page, 10_000, 5000);
    await expect(wake).toBeVisible();

    await wake.click();
    await expect(wake).toBeHidden();
    // The tap woke the screen and pressed nothing behind it: the Settings tab still shows, and the music still plays.
    await expect(page.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'Spotify' }).click();
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  });

  test('away from the kiosk there is no sleep button', async ({ page }) => {
    await page.goto('/?kiosk=0');
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Put the screen to sleep' })).toHaveCount(0);
  });

  test('a sleeping screen reads Spotify seldom, and reads again at once when it wakes', async ({ page }) => {
    const reads = countPlaybackReads(page);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();

    // Awake and watching another device, it asks every few seconds.
    const before = reads();
    await advance(page, 20_000);
    expect(reads() - before).toBeGreaterThanOrEqual(3);

    // The sleep button is in the Settings tab's header.
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByRole('tabpanel', { name: 'Settings' })).toBeVisible();
    const awake = reads();
    await page.getByRole('button', { name: 'Put the screen to sleep' }).click();
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

  test('with nothing playing the Dashboard comes up after two minutes and the screen sleeps the chosen time later, never while music plays', async ({
    page
  }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Settings' }).click();
    const settings = page.getByRole('tabpanel', { name: 'Settings' });
    await showSection(settings, 'General');
    const choices = settings.getByRole('group', { name: 'Screen sleep' });
    await choices.getByRole('button', { name: '2 min', exact: true }).click();
    await expect(choices.getByRole('button', { name: '2 min', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('tab', { name: 'Spotify' }).click();

    const wake = page.getByRole('button', { name: 'Wake the screen' });
    const dashboard = page.getByRole('tab', { name: 'Dashboard' });
    await advance(page, 4 * 60_000, 5000);
    await expect(wake).toHaveCount(0);
    await expect(dashboard).toHaveAttribute('aria-selected', 'false');

    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await advance(page, 100_000, 5000);
    await expect(dashboard).toHaveAttribute('aria-selected', 'false');
    await advance(page, 30_000, 5000);
    await expect(dashboard).toHaveAttribute('aria-selected', 'true');
    await expect(wake).toHaveCount(0);
    await advance(page, 100_000, 5000);
    await expect(wake).toHaveCount(0);
    await advance(page, 30_000, 5000);
    await expect(wake).toBeVisible();
  });

  test('Settings left alone give way to the Dashboard, which sleeps, and a tap wakes it to the Dashboard', async ({
    page
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByRole('tabpanel', { name: 'Settings' })).toBeVisible();

    // Nobody touches the screen, with nothing playing: two minutes to the Dashboard, then the default five to sleep.
    await advance(page, 2 * 60_000 + 5000, 5000);
    await expect(page.getByRole('tabpanel', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('tabpanel', { name: 'Settings' })).toBeHidden();
    await advance(page, 5 * 60_000, 5000);
    const wake = page.getByRole('button', { name: 'Wake the screen' });
    await expect(wake).toBeVisible();
    // The sleep screen covers everything, so the tap that wakes it reaches nothing behind it.
    await page.mouse.click(512, 300);
    await expect(wake).toHaveCount(0);
    await expect(page.getByRole('tabpanel', { name: 'Dashboard' })).toBeVisible();
  });
});
