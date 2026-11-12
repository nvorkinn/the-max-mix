import { expect, test, type Locator, type Page } from '@playwright/test';
import { fakeKioskAirPlay } from './fake-kiosk.ts';
import { COLOURED_ART, fakeSpotify, PIXEL } from './fake-spotify.ts';

// Layout bugs such as an overlapping or gapped sticky modal header are invisible to the DOM assertions elsewhere, so
// these tests compare screenshots. Baselines are rendered by Chrome on ubuntu-latest, the only place they are
// reliable, so the tests run in CI or when E2E_VISUAL is set (and the baselines then come from a matching machine).
test.skip(!process.env['CI'] && !process.env['E2E_VISUAL'], 'Screenshots are only stable on the CI browser.');

const SHOT = { animations: 'disabled', maxDiffPixelRatio: 0.002 } as const;

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

test.describe('Screenshots compared with their baselines', { tag: '@visual' }, () => {
  test.beforeEach(async ({ page }) => {
    // Short enough that the modals have to scroll, which is where the sticky header can go wrong.
    await page.setViewportSize({ width: 1024, height: 280 });
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
    );
  });

  test('settings modal at the top and scrolled', { tag: '@settings' }, async ({ page }) => {
    const dialog = await openSettings(page);
    await expect(dialog).toHaveScreenshot('settings-top.png', SHOT);
    await scrollToBottom(dialog);
    await expect(dialog).toHaveScreenshot('settings-scrolled.png', SHOT);
  });

  test('speakers drawer', { tag: '@speakers' }, async ({ page }) => {
    await fakeSpotify(page);
    // The drawer needs the height of a real screen, unlike the modals above, which are checked on a short one.
    await page.setViewportSize({ width: 1024, height: 600 });
    await page.goto('/');
    await page.getByRole('button', { name: /^Speakers:/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Speakers' });
    await expect(dialog.getByRole('button', { name: /Test speaker/ })).toBeVisible();
    // The clock and the seek position change as time passes, so they are masked out of the comparison.
    await expect(page).toHaveScreenshot('speakers-drawer.png', {
      ...SHOT,
      mask: [page.locator('.header-clock'), page.getByRole('slider', { name: 'Playback position' })]
    });
  });

  test('speakers drawer with AirPlay volumes', { tag: '@speakers' }, async ({ page }) => {
    await fakeSpotify(page);
    await fakeKioskAirPlay(page, { Kitchen: 40, Lounge: 70 }, ['Kitchen', 'Lounge']);
    await page.setViewportSize({ width: 1024, height: 600 });
    await page.goto('/');
    await page.getByRole('button', { name: /^Speakers:/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Speakers' });
    await dialog.getByRole('button', { name: "Show each speaker's volume" }).click();
    await expect(dialog.getByRole('slider', { name: 'Lounge volume' })).toBeVisible();
    await dialog.locator('.speaker-drawer-body').evaluate(element => {
      element.scrollTo({ top: element.scrollHeight });
    });
    await expect(page).toHaveScreenshot('speakers-drawer-airplay.png', {
      ...SHOT,
      mask: [page.locator('.header-clock'), page.getByRole('slider', { name: 'Playback position' })]
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
    const dialog = await openSettings(page);
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
