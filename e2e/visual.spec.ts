import { expect, test, type Page } from '@playwright/test';
import { airPlayOutput, fakeKioskOutputs } from './fake-kiosk.ts';
import { fakeSpotifySdk } from './fake-spotify-sdk.ts';
import { COLOURED_ART, fakeSpotify, PIXEL } from './fake-spotify.ts';
import { openSettings, showSection } from './settings.ts';

// Layout bugs such as an overlapping or gapped sticky modal header are invisible to the DOM assertions elsewhere, so
// these tests compare screenshots. Baselines are rendered by Chrome on ubuntu-latest, the only place they are
// reliable, so the tests run in CI or when E2E_VISUAL is set (and the baselines then come from a matching machine).
test.skip(!process.env['CI'] && !process.env['E2E_VISUAL'], 'Screenshots are only stable on the CI browser.');

const SHOT = { animations: 'disabled', maxDiffPixelRatio: 0.002 } as const;

// Both kiosk screens: the 7 inch (1024x600) and the 10.1 inch (1280x800). Each screen's baselines have their own folder.
const SCREENS = [
  { width: 1024, height: 600 },
  { width: 1280, height: 800 }
] as const;
type Screen = (typeof SCREENS)[number];
const size = (screen: Screen) => `${screen.width}x${screen.height}`;
const shotName = (name: string, screen: Screen) => [size(screen), `${name}.png`];

/** A coloured cover the page may read (Spotify's image CDN sends this header too), so the faint tint shows. */
async function colouredArt(page: Page) {
  await page.route('https://images.unsplash.com/**', route =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      headers: { 'access-control-allow-origin': '*' },
      body: COLOURED_ART
    })
  );
}

// The clock and the seek bar with its times change as the song plays, so they are masked out of the comparison.
const moving = (page: Page) => ({ ...SHOT, mask: [page.locator('.header-clock'), page.locator('.seek-control')] });

test.describe('Screenshots compared with their baselines', { tag: '@visual' }, () => {
  test.beforeEach(async ({ page }) => {
    // Short, so the setup screen has to fit a cramped window; the other screens set a real screen's size.
    await page.setViewportSize({ width: 1024, height: 280 });
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
    );
  });

  for (const screen of SCREENS) {
    test(`settings overview and pages at ${size(screen)}`, { tag: '@settings' }, async ({ page }) => {
      await page.setViewportSize(screen);
      await fakeSpotify(page);
      await page.route('http://127.0.0.1:7341/**', route =>
        route.fulfill(
          new URL(route.request().url()).pathname === '/wifi/status'
            ? { headers: { 'Access-Control-Allow-Origin': '*' }, json: { ssid: 'Home network' } }
            : { status: 204 }
        )
      );
      await page.route('https://api.github.com/**', route =>
        route.fulfill({
          json: { tag_name: 'v1.12.0', assets: [{ name: 'the-max-mix-pi.tar.gz', state: 'uploaded' }] }
        })
      );
      // The Software page says when GitHub last answered.
      await page.clock.setFixedTime(new Date('2026-11-13T08:43:00'));
      await page.goto('/?kiosk=1&pi_ref=v1.12.0&pi_commit=5a39e9a');
      const settings = await openSettings(page);
      await expect(
        settings.getByRole('group', { name: 'Overview' }).getByRole('button', { name: /^Software/ })
      ).toContainText('Up to date');
      await expect(settings).toHaveScreenshot(shotName('settings-overview', screen), SHOT);
      for (const [section, name] of [
        ['Appearance', 'settings-appearance'],
        ['Screen sleep', 'settings-sleep'],
        ['Wi-Fi', 'settings-wifi'],
        ['Spotify', 'settings-spotify'],
        ['Software', 'settings-software']
      ] as const) {
        // eslint-disable-next-line no-await-in-loop -- one page after another
        await showSection(settings, section);
        // eslint-disable-next-line no-await-in-loop -- the same
        await expect(settings).toHaveScreenshot(shotName(name, screen), SHOT);
      }
    });

    test(`settings at night at ${size(screen)}`, { tag: ['@settings', '@appearance'] }, async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('maxmix.theme', 'night');
      });
      await page.setViewportSize(screen);
      await page.goto('/');
      const settings = await openSettings(page, 'Appearance');
      await expect(settings).toHaveScreenshot(shotName('settings-night', screen), SHOT);
    });

    test(`player screen at ${size(screen)}`, { tag: '@player' }, async ({ page }) => {
      await fakeSpotify(page);
      await colouredArt(page);
      await page.setViewportSize(screen);
      await page.goto('/');
      await expect(page.getByRole('slider', { name: 'Playback position' })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Play Starboy/ })).toBeVisible();
      await expect(page).toHaveScreenshot(shotName('player', screen), moving(page));
    });

    test(`player screen at night at ${size(screen)}`, { tag: ['@player', '@appearance'] }, async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('maxmix.theme', 'night');
      });
      await fakeSpotify(page);
      await colouredArt(page);
      await page.setViewportSize(screen);
      await page.goto('/');
      await expect(page.getByRole('slider', { name: 'Playback position' })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Play Starboy/ })).toBeVisible();
      await expect(page).toHaveScreenshot(shotName('player-night', screen), moving(page));
    });

    test(
      `player screen in the Dynamic colour at ${size(screen)}`,
      { tag: ['@player', '@appearance'] },
      async ({ page }) => {
        await page.addInitScript(() => {
          localStorage.setItem('maxmix.themeColour', 'dynamic');
        });
        await fakeSpotify(page);
        await colouredArt(page);
        await page.setViewportSize(screen);
        await page.goto('/');
        await expect(page.getByRole('slider', { name: 'Playback position' })).toBeVisible();
        await expect(page.getByRole('button', { name: /^Play Starboy/ })).toBeVisible();
        await expect(page).toHaveScreenshot(shotName('player-dynamic', screen), moving(page));
      }
    );

    test(`speakers view at ${size(screen)}`, { tag: '@speakers' }, async ({ page }) => {
      await fakeSpotify(page);
      await page.setViewportSize(screen);
      await page.goto('/');
      await page.getByRole('button', { name: /^Speakers:/ }).click();
      const view = page.getByRole('region', { name: 'Speakers' });
      await expect(view.getByRole('checkbox', { name: 'Test speaker' })).toBeChecked();
      await expect(page).toHaveScreenshot(shotName('speakers-view', screen), moving(page));
    });

    test(`speakers view with AirPlay volumes at ${size(screen)}`, { tag: '@speakers' }, async ({ page }) => {
      await fakeSpotify(page);
      await fakeKioskOutputs(page, [
        airPlayOutput('Kitchen', 40),
        airPlayOutput('Lounge', 20),
        airPlayOutput('Study', 30)
      ]);
      await fakeSpotifySdk(page);
      await page.setViewportSize(screen);
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
      await expect(page).toHaveScreenshot(shotName('speakers-view-airplay', screen), moving(page));
    });

    test(`dashboard at ${size(screen)}`, { tag: '@layout' }, async ({ page }) => {
      await fakeSpotify(page);
      // The made-up departures and forecast are timed from now, so now is fixed.
      await page.clock.setFixedTime(new Date('2026-11-15T09:20:00'));
      await page.setViewportSize(screen);
      await page.goto('/');
      await page.getByRole('tab', { name: 'Dashboard' }).click();
      const dashboard = page.getByRole('tabpanel', { name: 'Dashboard' });
      await expect(dashboard.getByText('Tottenham Court Road')).toBeVisible();
      await expect(page).toHaveScreenshot(shotName('dashboard', screen), SHOT);
    });

    test(`music picker at ${size(screen)}`, { tag: '@music' }, async ({ page }) => {
      await fakeSpotify(page);
      await page.setViewportSize(screen);
      await page.goto('/');
      await page.getByRole('button', { name: 'Choose music' }).click();
      const dialog = page.getByRole('dialog', { name: 'Choose music' });
      await expect(dialog.getByRole('button', { name: /Deep Focus/ })).toBeVisible();
      await expect(dialog).toHaveScreenshot(shotName('music-picker', screen), SHOT);
    });

    test(`signed-out setup screen at ${size(screen)}`, { tag: '@setup' }, async ({ page }) => {
      await page.setViewportSize(screen);
      await page.goto('/');
      await expect(page.getByRole('button', { name: 'Connect Spotify' })).toBeVisible();
      await expect(page).toHaveScreenshot(shotName('setup', screen), {
        ...SHOT,
        mask: [page.locator('.header-clock')]
      });
    });
  }

  test('signed-out setup screen in a short window', { tag: '@setup' }, async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Connect Spotify' })).toBeVisible();
    // The header clock changes every minute, so it is masked out of the comparison.
    await expect(page).toHaveScreenshot('setup-short-window.png', { ...SHOT, mask: [page.locator('.header-clock')] });
  });
});
