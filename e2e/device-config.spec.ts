import { expect, test } from '@playwright/test';
import { DEVICE_CONFIGS, fakeCountdownServer } from './fake-countdown.ts';
import { fakeSpotify, PIXEL } from './fake-spotify.ts';
import { openSettings } from './settings.ts';
import { openSpotifyTab } from './spotify-tab.ts';

test.describe("The kiosk's config from countdown-server", { tag: ['@registration', '@appearance'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
    );
    await fakeSpotify(page);
  });

  test("an owned kiosk takes the server's colour, asking with its secret", async ({ page }) => {
    // Routes added later answer first, so this one stands in for fakeSpotify's.
    const server = await fakeCountdownServer(page, {
      ...DEVICE_CONFIGS.owned,
      style: { skin: 'night', colour: 'pink' }
    });
    await openSpotifyTab(page, '/?kiosk=1');

    await expect(page.locator('.tablet-container')).toHaveAttribute('data-colour', 'pink');
    expect(server.authorizations).toEqual(['Bearer e2e-not-a-real-secret']);
  });

  test('an unowned kiosk keeps its own settings', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('maxmix.themeColour', 'teal');
    });
    const server = await fakeCountdownServer(page, null);
    await openSpotifyTab(page, '/?kiosk=1');

    await expect.poll(() => server.authorizations.length).toBe(1);
    await expect(page.locator('.tablet-container')).toHaveAttribute('data-colour', 'teal');
  });

  test('a change in the settings saves to the server at once, and shows Saved', async ({ page }) => {
    const server = await fakeCountdownServer(page, DEVICE_CONFIGS.owned);
    await openSpotifyTab(page, '/?kiosk=1');
    const settings = await openSettings(page, 'Appearance');

    await settings.getByRole('button', { name: 'Navy' }).click();
    await expect(page.locator('.tablet-container')).toHaveAttribute('data-colour', 'navy');
    await expect(settings.getByText('Saved', { exact: true })).toBeVisible();
    expect(server.saves).toHaveLength(1);
    expect(server.saves[0]).toMatchObject({
      device_id: '0a1b2c3d4e5f',
      style: { skin: 'auto', colour: 'navy', dynamic: true }
    });
  });

  test("the lyrics look is the server's, and saves there from the Appearance page", async ({ page }) => {
    const server = await fakeCountdownServer(page, {
      ...DEVICE_CONFIGS.owned,
      lyrics: { size: 'large', align: 'center' }
    });
    await openSpotifyTab(page, '/?kiosk=1');
    const settings = await openSettings(page, 'Appearance');

    await expect(settings.getByRole('button', { name: 'Large', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(settings.getByRole('button', { name: 'Centre' })).toHaveAttribute('aria-pressed', 'true');
    await settings.getByRole('button', { name: 'Right' }).click();
    await expect(settings.getByRole('button', { name: 'Right' })).toHaveAttribute('aria-pressed', 'true');
    await expect(settings.getByText('Saved', { exact: true })).toBeVisible();
    expect(server.saves.map(save => save['lyrics'])).toEqual([{ size: 'large', align: 'right' }]);
    // Kept on the tablet too, for a start without the server.
    expect(await page.evaluate(() => localStorage.getItem('maxmix.lyricsStyle'))).toBe(
      JSON.stringify({ size: 'large', align: 'right' })
    );
  });

  test("parcels' switch, arriving by and delivered ones stay save from the Notices page to the server", async ({
    page
  }) => {
    const server = await fakeCountdownServer(page, DEVICE_CONFIGS.owned);
    await openSpotifyTab(page, '/?kiosk=1');
    const settings = await openSettings(page, 'Notices');
    // A quick run of changes saves only the last, so each waits for the one before it to save.
    const pick = async (group: string, choice: string) => {
      const saves = server.saves.length;
      const button = settings.getByRole('group', { name: group }).getByRole('button', { name: choice });
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => server.saves.length).toBe(saves + 1);
    };

    const notices = settings.getByRole('switch', { name: 'Parcels' });
    await expect(notices).toHaveAttribute('aria-checked', 'false');
    await notices.click();
    await expect(notices).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => server.saves.length).toBe(1);
    await pick('Arriving by', 'Day after');
    await pick('Delivered ones stay', 'A day');
    await expect(settings.getByText('Saved', { exact: true })).toBeVisible();
    expect(server.saves.map(save => save['parcels'])).toEqual([
      { enabled: true, days_ahead: null, kept_hours: 4 },
      { enabled: true, days_ahead: 2, kept_hours: 4 },
      { enabled: true, days_ahead: 2, kept_hours: 24 }
    ]);
  });

  test('how soon a bank holiday shows saves from the Notices page to the server', async ({ page }) => {
    const server = await fakeCountdownServer(page, DEVICE_CONFIGS.owned);
    await openSpotifyTab(page, '/?kiosk=1');
    const settings = await openSettings(page, 'Notices');
    const holidays = settings.getByRole('group', { name: 'Bank holidays' });
    const button = holidays.getByRole('button', { name: '2 days before' });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => server.saves.map(save => save['holidays'])).toEqual([{ days_ahead: 2 }]);
  });

  test('a quick run of changes saves only the last one', async ({ page }) => {
    const server = await fakeCountdownServer(page, DEVICE_CONFIGS.owned);
    await openSpotifyTab(page, '/?kiosk=1');
    const settings = await openSettings(page, 'Screen');

    // Both taps in one go: two Playwright clicks each wait for the page to settle, which on a busy runner can take
    // longer than the save's debounce and so save both.
    await expect(settings.getByRole('button', { name: '2 min' })).toBeVisible();
    await settings.evaluate(panel => {
      for (const name of ['2 min', '30 min']) {
        [...panel.querySelectorAll('button')].find(button => button.textContent === name)?.click();
      }
    });
    await expect(settings.getByText('Saved', { exact: true })).toBeVisible();
    expect(server.saves.map(save => save['display'])).toEqual([{ ...DEVICE_CONFIGS.owned.display, sleep_minutes: 30 }]);
  });

  test("a change the server refuses is undone, and says it wasn't saved", async ({ page }) => {
    await fakeCountdownServer(page, DEVICE_CONFIGS.owned, { saveStatus: 500 });
    await openSpotifyTab(page, '/?kiosk=1');
    const settings = await openSettings(page, 'Appearance');

    await settings.getByRole('button', { name: 'Navy' }).click();
    await expect(settings.getByText('Not saved', { exact: true })).toBeVisible();
    await expect(page.locator('.tablet-container')).toHaveAttribute('data-colour', 'violet');
  });

  test('the Countdown page adds a stop found by search and saves the departures', async ({ page }) => {
    const server = await fakeCountdownServer(page, DEVICE_CONFIGS.owned);
    await openSpotifyTab(page, '/?kiosk=1');
    const settings = await openSettings(page, 'Countdown');
    // The config's stop, added elsewhere, takes its name from its departures on the server.
    await expect(settings.getByRole('list', { name: 'Saved stops' }).getByText('Majorstuen')).toBeVisible();

    await settings.getByRole('button', { name: 'Add a station or stop' }).click();
    const search = page.getByRole('dialog', { name: 'Add stops' });
    await search.getByRole('searchbox', { name: 'Search for a stop' }).fill('oslo s');
    await search
      .getByRole('list', { name: 'Results' })
      .getByRole('button', { name: /Platform 4/ })
      .click();
    await expect(search.getByRole('button', { name: /Platform 4.*Added/ })).toBeVisible();
    await search.getByRole('button', { name: 'Close' }).click();

    await expect(settings.getByRole('list', { name: 'Saved stops' }).getByText('Oslo S')).toBeVisible();
    await expect(settings.getByText('Saved', { exact: true })).toBeVisible();
    expect(server.saves.map(save => save['arrivals'])).toEqual([
      {
        stops: [
          { source: 'entur', id: 'NSR:StopPlace:58381' },
          { source: 'entur', id: 'NSR:Quay:7333' }
        ],
        group_by_route: false
      }
    ]);
  });

  test("the weather's Current location fills in the place where the browser is, saved once tapped", async ({
    page,
    context
  }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 59.9139, longitude: 10.7522 });
    const server = await fakeCountdownServer(page, DEVICE_CONFIGS.owned);
    const asked = page.waitForRequest(request => request.url().includes('/api/places/here?'));
    await openSpotifyTab(page, '/?kiosk=1');
    const settings = await openSettings(page, 'General');

    await settings.getByRole('region', { name: 'Location' }).getByRole('button', { name: 'Change' }).click();
    const dialog = page.getByRole('dialog', { name: 'Location' });
    await dialog.getByRole('button', { name: 'Current location' }).click();
    expect(new URL((await asked).url()).searchParams.get('latitude')).toBe('59.9139');
    await expect(dialog.getByRole('searchbox', { name: 'Location' })).toHaveValue('Oslo');
    expect(server.saves).toEqual([]);
    await dialog.getByRole('button', { name: /^Oslo/ }).click();
    await expect(settings.getByText('Saved', { exact: true })).toBeVisible();
    expect(server.saves.map(save => save['weather'])).toEqual([{ location: 'Oslo', key: 'oslo-no-3143244' }]);
  });

  test('the time format on the General page changes the tab bar clock and saves', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-15T16:05:00'));
    const server = await fakeCountdownServer(page, DEVICE_CONFIGS.owned);
    await openSpotifyTab(page, '/?kiosk=1');
    await expect(page.getByRole('tabpanel', { name: 'Spotify' }).locator('.dashboard-clock')).toHaveText('16:05');
    const settings = await openSettings(page, 'General');

    // Each format shows the clock as it writes it.
    await expect(settings.getByRole('button', { name: '24-hour' })).toContainText('16:05');
    await expect(settings.getByRole('button', { name: '12-hour' })).toContainText(/4:05\sPM/i);
    await settings.getByRole('button', { name: '12-hour' }).click();
    await expect(settings.locator('.dashboard-clock')).toHaveText(/^\s*4:05\sPM$/i);
    await expect(settings.getByText('Saved', { exact: true })).toBeVisible();
    expect(server.saves.map(save => save['clock_format'])).toEqual(['12h']);
  });
});
