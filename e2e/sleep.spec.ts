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
    // The tap woke the screen and did not press Pause behind it.
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

    await page.getByRole('button', { name: 'Put the screen to sleep' }).click();
    await expect(page.getByRole('button', { name: 'Wake the screen' })).toBeVisible();
    // Falling asleep reads once more, then it goes quiet.
    await advance(page, 1000);
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

  test('with nothing playing the screen sleeps after the chosen idle time, and never while music plays', async ({
    page
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await showSection(settings, 'Screen sleep');
    const choices = settings.getByRole('group', { name: 'Screen sleep' });
    await choices.getByRole('button', { name: '2 min', exact: true }).click();
    await expect(choices.getByRole('button', { name: '2 min', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await settings.getByRole('button', { name: 'Close settings' }).click();

    const wake = page.getByRole('button', { name: 'Wake the screen' });
    await advance(page, 4 * 60_000, 5000);
    await expect(wake).toHaveCount(0);

    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await advance(page, 100_000, 5000);
    await expect(wake).toHaveCount(0);
    await advance(page, 30_000, 5000);
    await expect(wake).toBeVisible();
  });

  test('a screen that falls asleep while Settings is open goes black over it, and a tap wakes it to Settings', async ({
    page
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Open settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await expect(settings).toBeVisible();

    // Nobody touches the screen for the default five minutes, with nothing playing.
    await advance(page, 5 * 60_000 + 5000, 5000);
    const wake = page.getByRole('button', { name: 'Wake the screen' });
    await expect(wake).toBeVisible();
    // The sleep screen is on top of the open dialog, so a tap in the middle of the screen lands on it and wakes it.
    await page.mouse.click(512, 300);
    await expect(wake).toHaveCount(0);
    // Waking shows Settings again, as it was left; it is not closed into a sleeping screen.
    await expect(settings).toBeVisible();
  });
});
