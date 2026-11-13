import { expect, test } from '@playwright/test';
import { airPlayOutput, fakeKioskOutputs } from './fake-kiosk.ts';
import { fakeSpotifySdk } from './fake-spotify-sdk.ts';
import { COLOURED_ART, fakeSpotify, PIXEL } from './fake-spotify.ts';
import { openSettings, showSection } from './settings.ts';

// Layout bugs such as an overlapping or gapped sticky modal header are invisible to the DOM assertions elsewhere, so
// these tests compare screenshots. Baselines are rendered by Chrome on ubuntu-latest, the only place they are
// reliable, so the tests run in CI or when E2E_VISUAL is set (and the baselines then come from a matching machine).
test.skip(!process.env['CI'] && !process.env['E2E_VISUAL'], 'Screenshots are only stable on the CI browser.');

const SHOT = { animations: 'disabled', maxDiffPixelRatio: 0.002 } as const;

test.describe('Screenshots compared with their baselines', { tag: '@visual' }, () => {
  test.beforeEach(async ({ page }) => {
    // Short, so the setup screen has to fit a cramped window; the other screens set a real screen's size.
    await page.setViewportSize({ width: 1024, height: 280 });
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
    );
  });

  test('settings overview and pages on the kiosk', { tag: '@settings' }, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 600 });
    await fakeSpotify(page);
    await page.route('http://127.0.0.1:7341/**', route =>
      route.fulfill(
        new URL(route.request().url()).pathname === '/wifi/status'
          ? { headers: { 'Access-Control-Allow-Origin': '*' }, json: { ssid: 'Home network' } }
          : { status: 204 }
      )
    );
    await page.route('https://api.github.com/**', route => route.fulfill({ json: { tag_name: 'v1.12.0' } }));
    // The Software page says when GitHub last answered.
    await page.clock.setFixedTime(new Date('2026-11-13T08:43:00'));
    await page.goto('/?kiosk=1&pi_ref=v1.12.0&pi_commit=5a39e9a');
    const dialog = await openSettings(page);
    await expect(
      dialog.getByRole('group', { name: 'Overview' }).getByRole('button', { name: /^Software/ })
    ).toContainText('Up to date');
    await expect(dialog).toHaveScreenshot('settings-overview.png', SHOT);
    for (const [section, shot] of [
      ['Appearance', 'settings-appearance.png'],
      ['Screen sleep', 'settings-sleep.png'],
      ['Wi-Fi', 'settings-wifi.png'],
      ['Spotify', 'settings-spotify.png'],
      ['Software', 'settings-software.png']
    ] as const) {
      // eslint-disable-next-line no-await-in-loop -- one page after another
      await showSection(dialog, section);
      // eslint-disable-next-line no-await-in-loop -- the same
      await expect(dialog).toHaveScreenshot(shot, SHOT);
    }
  });

  test('settings in a 1280x800 window', { tag: '@settings' }, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    const dialog = await openSettings(page);
    await expect(dialog).toHaveScreenshot('settings-1280x800.png', SHOT);
  });

  test('speakers view', { tag: '@speakers' }, async ({ page }) => {
    await fakeSpotify(page);
    // The view needs the height of a real screen, unlike the modals above, which are checked on a short one.
    await page.setViewportSize({ width: 1024, height: 600 });
    await page.goto('/');
    await page.getByRole('button', { name: /^Speakers:/ }).click();
    const view = page.getByRole('region', { name: 'Speakers' });
    await expect(view.getByRole('checkbox', { name: 'Test speaker' })).toBeChecked();
    // The clock and the seek bar with its times change as the song plays, so they are masked out of the comparison.
    await expect(page).toHaveScreenshot('speakers-view.png', {
      ...SHOT,
      mask: [page.locator('.header-clock'), page.locator('.seek-control')]
    });
  });

  test('speakers view with AirPlay volumes', { tag: '@speakers' }, async ({ page }) => {
    await fakeSpotify(page);
    await fakeKioskOutputs(page, [
      airPlayOutput('Kitchen', 40),
      airPlayOutput('Lounge', 20),
      airPlayOutput('Study', 30)
    ]);
    await fakeSpotifySdk(page);
    await page.setViewportSize({ width: 1024, height: 600 });
    await page.goto('/');
    await page.getByRole('button', { name: /^Speakers:/ }).click();
    const view = page.getByRole('region', { name: 'Speakers' });
    const nav = page.getByRole('navigation', { name: 'Beside the artwork' });
    await view.getByRole('checkbox', { name: 'This tablet' }).click();
    await nav.getByRole('button', { name: 'Save' }).click();
    await expect(nav.getByRole('button', { name: 'Speakers' })).toBeVisible();
    await view.getByRole('button', { name: 'AirPlay' }).click();
    await view.getByRole('checkbox', { name: 'Kitchen' }).click();
    await view.getByRole('checkbox', { name: 'Lounge' }).click();
    await nav.getByRole('button', { name: 'Save' }).click();
    await expect(nav.getByRole('button', { name: 'Speakers' })).toBeVisible();
    await view.getByRole('button', { name: 'Volumes' }).click();
    await expect(view.getByRole('slider', { name: 'Lounge volume' })).toBeVisible();
    await expect(page).toHaveScreenshot('speakers-view-airplay.png', {
      ...SHOT,
      mask: [page.locator('.header-clock'), page.locator('.seek-control')]
    });
  });

  test('player screen', { tag: '@player' }, async ({ page }) => {
    await fakeSpotify(page);
    // A coloured cover the page may read (Spotify's image CDN sends this header too), so the faint tint shows.
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        headers: { 'access-control-allow-origin': '*' },
        body: COLOURED_ART
      })
    );
    await page.setViewportSize({ width: 1024, height: 600 });
    await page.goto('/');
    await expect(page.getByRole('slider', { name: 'Playback position' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Play Starboy/ })).toBeVisible();
    // The clock and the seek bar with its times change as the song plays, so they are masked out of the comparison.
    await expect(page).toHaveScreenshot('player.png', {
      ...SHOT,
      mask: [page.locator('.header-clock'), page.locator('.seek-control')]
    });
  });

  test('player screen at night', { tag: ['@player', '@appearance'] }, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('maxmix.theme', 'night');
    });
    await fakeSpotify(page);
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        headers: { 'access-control-allow-origin': '*' },
        body: COLOURED_ART
      })
    );
    await page.setViewportSize({ width: 1024, height: 600 });
    await page.goto('/');
    await expect(page.getByRole('slider', { name: 'Playback position' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Play Starboy/ })).toBeVisible();
    await expect(page).toHaveScreenshot('player-night.png', {
      ...SHOT,
      mask: [page.locator('.header-clock'), page.locator('.seek-control')]
    });
  });

  test('settings modal at night', { tag: ['@settings', '@appearance'] }, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('maxmix.theme', 'night');
    });
    await page.setViewportSize({ width: 1024, height: 600 });
    await page.goto('/');
    const dialog = await openSettings(page, 'Appearance');
    await expect(dialog).toHaveScreenshot('settings-night.png', SHOT);
  });

  test('music picker', { tag: '@music' }, async ({ page }) => {
    await fakeSpotify(page);
    await page.setViewportSize({ width: 1024, height: 600 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Choose music' }).click();
    const dialog = page.getByRole('dialog', { name: 'Choose music' });
    await expect(dialog.getByRole('button', { name: /Deep Focus/ })).toBeVisible();
    await expect(dialog).toHaveScreenshot('music-picker.png', SHOT);
  });

  test('signed-out setup screen', { tag: '@setup' }, async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Connect Spotify' })).toBeVisible();
    // The header clock changes every minute, so it is masked out of the comparison.
    await expect(page).toHaveScreenshot('setup.png', { ...SHOT, mask: [page.locator('.header-clock')] });
  });
});
