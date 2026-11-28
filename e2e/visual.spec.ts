import { expect, test, type Page } from '@playwright/test';
import { showDashboard } from './dashboard.ts';
import { DEVICE_CONFIGS, fakeCountdownServer } from './fake-countdown.ts';
import { airPlayOutput, fakeKioskOutputs, phoneSetupAnswer, wifiAnswer } from './fake-kiosk.ts';
import { fakeSoloist } from './fake-soloist.ts';
import { COLOURED_ART, fakeSpotify, PIXEL } from './fake-spotify.ts';
import { openSettings, showSection } from './settings.ts';
import { openSpotifyTab } from './spotify-tab.ts';

// Layout bugs such as an overlapping or gapped sticky modal header are invisible to the DOM assertions elsewhere, so
// these tests compare screenshots. Baselines are rendered by Chrome on ubuntu-latest, the only place they are
// reliable, so the tests run in CI or when E2E_VISUAL is set (and the baselines then come from a matching machine).
test.skip(!process.env['CI'] && !process.env['E2E_VISUAL'], 'Screenshots are only stable on the CI browser.');

const SHOT = { animations: 'disabled', maxDiffPixelRatio: 0.002 } as const;

// The 10.1 inch kiosk screen (1280x800). The 7 inch (1024x600) is left out of CI for now; its baselines stay in their
// folder for when it comes back. Each screen's baselines have their own folder.
const SCREENS = [{ width: 1280, height: 800 }] as const;
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
const moving = (page: Page) => ({
  ...SHOT,
  mask: [page.locator('.dashboard-clock'), page.locator('.seek-control')]
});

test.describe('Screenshots compared with their baselines', { tag: '@visual' }, () => {
  test.beforeEach(async ({ page }) => {
    // Short, so the setup screen has to fit a cramped window; the other screens set a real screen's size.
    await page.setViewportSize({ width: 1024, height: 280 });
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
    );
  });

  for (const screen of SCREENS) {
    test(`settings pages at ${size(screen)}`, { tag: '@settings' }, async ({ page }) => {
      await page.setViewportSize(screen);
      await fakeSpotify(page);
      await page.route('http://127.0.0.1:7341/**', route =>
        route.fulfill(wifiAnswer(route.request(), 'Home network') ?? { status: 204 })
      );
      const current = 'v1.12.0+5a39e9a0';
      const upToDate = { channel: 'stable', current, installed: null, failed: null, busy: false, latest: current };
      await page.route('http://127.0.0.1:7341/update/check', route =>
        route.fulfill({
          headers: { 'Access-Control-Allow-Origin': '*' },
          json: { ...upToDate, result: 'up-to-date' }
        })
      );
      // The About page says when the update channel was last read.
      await page.clock.setFixedTime(new Date('2026-11-13T08:43:00'));
      await page.goto('/?kiosk=1&pi_ref=v1.12.0&pi_commit=5a39e9a');
      const settings = await openSettings(page);
      for (const [section, name] of [
        ['Wi-Fi', 'settings-wifi'],
        ['Screen', 'settings-screen'],
        ['Appearance', 'settings-appearance'],
        ['Spotify', 'settings-spotify'],
        ['About', 'settings-about']
      ] as const) {
        // eslint-disable-next-line no-await-in-loop -- one page after another
        await showSection(settings, section);
        // The About page waits for the update channel's answer, which it shows.
        // eslint-disable-next-line no-await-in-loop -- the same
        if (section === 'About') await expect(settings.getByRole('status')).toContainText('Up to date');
        // eslint-disable-next-line no-await-in-loop -- the same
        await expect.soft(settings).toHaveScreenshot(shotName(name, screen), SHOT);
      }
    });

    test(`Wi-Fi Hotspot dialog at ${size(screen)}`, { tag: '@settings' }, async ({ page }) => {
      await page.setViewportSize(screen);
      await fakeSpotify(page);
      let hotspotState = 'running';
      await page.route('http://127.0.0.1:7341/**', route => {
        const request = route.request();
        return route.fulfill(
          phoneSetupAnswer(request, hotspotState) ?? wifiAnswer(request, 'Home network') ?? { status: 204 }
        );
      });
      await page.goto('/?kiosk=1');
      const settings = await openSettings(page, 'Wi-Fi');

      // Step 1 open, then step 2 once a phone is on the hotspot.
      await settings.getByRole('button', { name: 'Use your phone', exact: true }).click();
      const hotspot = page.getByRole('dialog', { name: 'Hotspot' });
      const steps = hotspot.getByRole('listitem');
      await expect(steps.first()).toHaveAttribute('aria-current', 'step');
      await expect.soft(page).toHaveScreenshot(shotName('wifi-hotspot', screen), SHOT);
      hotspotState = 'connected';
      await expect(steps.last()).toHaveAttribute('aria-current', 'step');
      await expect.soft(page).toHaveScreenshot(shotName('wifi-hotspot-step-2', screen), SHOT);
      hotspotState = 'joining';
      await expect(hotspot.getByTestId('hotspot-joining')).toHaveText('Home network');
      await expect.soft(page).toHaveScreenshot(shotName('wifi-hotspot-joining', screen), SHOT);
    });

    test(`settings Countdown page at ${size(screen)}`, { tag: '@settings' }, async ({ page }) => {
      await page.setViewportSize(screen);
      await fakeCountdownServer(page, {
        ...DEVICE_CONFIGS.owned,
        arrivals: {
          stops: [
            { source: 'entur', id: 'NSR:StopPlace:337' },
            { source: 'tfl', id: '490000077E' }
          ]
        }
      });
      // The names the kiosk kept when it added the stops (the config has only their ids).
      await page.addInitScript(() => {
        localStorage.setItem(
          'maxmix.savedStops',
          JSON.stringify({
            'entur:NSR:StopPlace:337': {
              name: 'Oslo S',
              detail: 'Train & Metro • All platforms • L1, R10, 1, 2 (+12 more)'
            },
            'tfl:490000077E': { name: 'Oval Station', detail: '36, 185, 436', letter: 'E' }
          })
        );
      });
      await page.goto('/?kiosk=1');
      const settings = await openSettings(page, 'Countdown');
      await expect(settings.getByText('Oslo S')).toBeVisible();
      await expect(settings).toHaveScreenshot(shotName('settings-countdown', screen), SHOT);
    });

    test(`settings General page of an owned kiosk at ${size(screen)}`, { tag: '@settings' }, async ({ page }) => {
      await page.setViewportSize(screen);
      await fakeCountdownServer(page, DEVICE_CONFIGS.owned);
      // The time formats show the clock as each writes it.
      await page.clock.setFixedTime(new Date('2026-11-13T13:44:00'));
      await page.goto('/?kiosk=1');
      const settings = await openSettings(page, 'General');
      await expect(settings.getByRole('img', { name: 'Norway' })).toBeVisible();
      await expect(settings).toHaveScreenshot(shotName('settings-general-owned', screen), SHOT);
    });

    test(
      `settings Screen page with a backlight and quiet hours at ${size(screen)}`,
      { tag: '@settings' },
      async ({ page }) => {
        await page.setViewportSize(screen);
        await fakeCountdownServer(page, {
          ...DEVICE_CONFIGS.owned,
          brightness_control: true,
          display: { sleep_minutes: 15, brightness: 80, quiet_hours: { on: true, start: 22 * 60, end: 7 * 60 } }
        });
        // Midday, outside the quiet hours, so the screen stays awake.
        await page.clock.setFixedTime(new Date('2026-11-13T12:00:00'));
        await page.goto('/?kiosk=1');
        const settings = await openSettings(page, 'Screen');
        await expect(settings.getByRole('slider', { name: 'Brightness' })).toHaveValue('80');
        await expect(settings.getByRole('slider', { name: 'From' })).toBeVisible();
        await expect(settings).toHaveScreenshot(shotName('settings-screen-backlit', screen), SHOT);
      }
    );

    test(`settings Parcels page at ${size(screen)}`, { tag: '@settings' }, async ({ page }) => {
      await page.setViewportSize(screen);
      await fakeCountdownServer(page, {
        ...DEVICE_CONFIGS.owned,
        parcels: { enabled: true, days_ahead: 1, kept_hours: 4 }
      });
      await page.goto('/?kiosk=1');
      const settings = await openSettings(page, 'Parcels');
      await expect(settings.getByRole('button', { name: 'Tomorrow' })).toHaveAttribute('aria-pressed', 'true');
      await expect(settings).toHaveScreenshot(shotName('settings-parcels', screen), SHOT);
    });

    test(`player screen at ${size(screen)}`, { tag: '@player' }, async ({ page }) => {
      await fakeSpotify(page);
      await colouredArt(page);
      await page.setViewportSize(screen);
      await openSpotifyTab(page);
      await expect(page.getByRole('slider', { name: 'Playback position' })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Play Starboy/ })).toBeVisible();
      await expect(page).toHaveScreenshot(shotName('player', screen), moving(page));
    });

    test(`player screen with an empty queue at ${size(screen)}`, { tag: '@player' }, async ({ page }) => {
      await fakeSpotify(page);
      await colouredArt(page);
      // Nothing queued: the queue's place holds one big button into search.
      await page.route('https://api.spotify.com/v1/me/player/queue', route =>
        route.fulfill({ json: { currently_playing: null, queue: [] } })
      );
      await page.setViewportSize(screen);
      await openSpotifyTab(page);
      await expect(page.getByRole('slider', { name: 'Playback position' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Search for music' })).toBeVisible();
      await expect(page).toHaveScreenshot(shotName('player-empty-queue', screen), moving(page));
    });

    test(`player screen with Dynamic on at ${size(screen)}`, { tag: ['@player', '@appearance'] }, async ({ page }) => {
      await fakeSpotify(page);
      await colouredArt(page);
      await page.setViewportSize(screen);
      await openSpotifyTab(page);
      await expect(page.getByRole('slider', { name: 'Playback position' })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Play Starboy/ })).toBeVisible();
      await expect(page).toHaveScreenshot(shotName('player-dynamic', screen), moving(page));
    });

    test(`speakers view at ${size(screen)}`, { tag: '@speakers' }, async ({ page }) => {
      await fakeSpotify(page);
      await page.setViewportSize(screen);
      await openSpotifyTab(page);
      await page.getByRole('button', { name: /^Speakers:/ }).click();
      const view = page.getByRole('region', { name: 'Speakers' });
      await expect(view.getByRole('checkbox', { name: 'Test speaker' })).toBeChecked();
      await expect(page).toHaveScreenshot(shotName('speakers-view', screen), moving(page));
    });

    test(`speakers view with AirPlay volumes at ${size(screen)}`, { tag: '@speakers' }, async ({ page }) => {
      const spotify = await fakeSpotify(page);
      await fakeKioskOutputs(page, [
        airPlayOutput('Kitchen', 40),
        airPlayOutput('Lounge', 20),
        airPlayOutput('Study', 30)
      ]);
      await fakeSoloist(page, spotify);
      await page.setViewportSize(screen);
      await openSpotifyTab(page);
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

    // The Dashboard shows countdown-server's live feed for an owned kiosk, the clock fixed so the departures read the
    // same every run.
    test(`dashboard at ${size(screen)}`, { tag: '@layout' }, async ({ page }) => {
      await showDashboard(page, screen);
      await expect(page).toHaveScreenshot(shotName('dashboard', screen), SHOT);
    });

    test(`dashboard notice at ${size(screen)}`, { tag: '@layout' }, async ({ page }) => {
      await showDashboard(page, screen);
      await page.getByRole('button', { name: /Northern line/ }).click();
      await expect(page.getByRole('dialog', { name: /Northern line/ })).toBeVisible();
      await expect(page).toHaveScreenshot(shotName('dashboard-notice', screen), SHOT);
    });

    test(`music picker at ${size(screen)}`, { tag: '@music' }, async ({ page }) => {
      await fakeSpotify(page);
      await page.setViewportSize(screen);
      await openSpotifyTab(page);
      await page.getByRole('button', { name: 'Choose music' }).click();
      const dialog = page.getByRole('dialog', { name: 'Choose music' });
      await expect(dialog.getByRole('button', { name: /Deep Focus/ })).toBeVisible();
      await expect(dialog).toHaveScreenshot(shotName('music-picker', screen), SHOT);
    });

    test(`signed-out setup screen at ${size(screen)}`, { tag: '@setup' }, async ({ page }) => {
      await page.setViewportSize(screen);
      await openSpotifyTab(page);
      await expect(page.getByRole('button', { name: 'Connect Spotify' })).toBeVisible();
      await expect(page).toHaveScreenshot(shotName('setup', screen), {
        ...SHOT,
        mask: [page.locator('.dashboard-clock')]
      });
    });
  }

  test('signed-out setup screen in a short window', { tag: '@setup' }, async ({ page }) => {
    await openSpotifyTab(page);
    await expect(page.getByRole('button', { name: 'Connect Spotify' })).toBeVisible();
    // The clock changes every minute, so it is masked out of the comparison.
    await expect(page).toHaveScreenshot('setup-short-window.png', {
      ...SHOT,
      mask: [page.locator('.dashboard-clock')]
    });
  });
});
