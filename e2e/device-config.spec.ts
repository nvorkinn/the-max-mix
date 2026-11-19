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

  test('a quick run of changes saves only the last one', async ({ page }) => {
    const server = await fakeCountdownServer(page, DEVICE_CONFIGS.owned);
    await openSpotifyTab(page, '/?kiosk=1');
    const settings = await openSettings(page, 'General');

    await settings.getByRole('button', { name: '2 min' }).click();
    await settings.getByRole('button', { name: '30 min' }).click();
    await expect(settings.getByText('Saved', { exact: true })).toBeVisible();
    expect(server.saves.map(save => save['display'])).toEqual([{ sleep_minutes: 30 }]);
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
    await expect(search.getByRole('button', { name: /Platform 4.*Added/ })).toBeDisabled();
    await search.getByRole('button', { name: 'Close' }).click();

    await expect(settings.getByRole('list', { name: 'Saved stops' }).getByText('Oslo S')).toBeVisible();
    await expect(settings.getByText('Saved', { exact: true })).toBeVisible();
    expect(server.saves.map(save => save['arrivals'])).toEqual([
      {
        stops: [
          { source: 'entur', id: 'NSR:StopPlace:58381' },
          { source: 'entur', id: 'NSR:Quay:7333' }
        ]
      }
    ]);
  });

  test('the time format on the General page changes the tab bar clock and saves', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-15T16:05:00'));
    const server = await fakeCountdownServer(page, DEVICE_CONFIGS.owned);
    await openSpotifyTab(page, '/?kiosk=1');
    await expect(page.getByRole('tabpanel', { name: 'Spotify' }).locator('.dashboard-clock')).toHaveText('16:05');
    const settings = await openSettings(page, 'General');

    await settings.getByRole('button', { name: '12-hour' }).click();
    await expect(settings.locator('.dashboard-clock')).toHaveText(/^\s*4:05\sPM$/i);
    await expect(settings.getByText('Saved', { exact: true })).toBeVisible();
    expect(server.saves.map(save => save['clock_format'])).toEqual(['12h']);
  });
});
