import { expect, test } from '@playwright/test';
import type { Locator, Page, Route } from '@playwright/test';
import { DEVICE_CONFIGS, fakeCountdownServer, locate, LOCATED } from './fake-countdown.ts';
import { fakeSignedOutSoloist } from './fake-soloist.ts';
import { PIXEL } from './fake-spotify.ts';

// countdown-server's screens' API, as the build names it (.env.production).
const API = 'https://api.countdown.build';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST'
};

/**
 * Stands in for countdown-server's device registration (POST /api/devices/register) and its account route, which
 * answers 409 until someone has scanned the QR code and owns the kiosk (`pair()`). Returns what the kiosk sent.
 */
async function fakePairing(page: Page) {
  const registrations: Record<string, unknown>[] = [];
  const accountAuthorizations: string[] = [];
  let isPaired = false;
  // Anything else of the API's, e.g. the config an unowned kiosk doesn't ask for: as for a secret it doesn't know.
  await page.route(`${API}/**`, route => route.fulfill({ status: 401, headers: CORS }));
  await page.route(`${API}/api/devices/register`, (route: Route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    registrations.push(request.postDataJSON() as Record<string, unknown>);
    return route.fulfill({ status: 201, headers: CORS, json: { device_id: '0a1b2c3d4e5f' } });
  });
  await page.route(`${API}/api/devices/account`, (route: Route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    accountAuthorizations.push(request.headers()['authorization'] ?? '');
    return route.fulfill(
      isPaired
        ? { status: 200, headers: CORS, json: { parcel: { linked: false }, spotify: { linked: false } } }
        : { status: 409, headers: CORS, json: { error: "the device isn't paired yet" } }
    );
  });
  return {
    registrations,
    accountAuthorizations,
    pair: () => {
      isPaired = true;
    }
  };
}

/** The Pi's Bluetooth while it looks for the phone: `report.pairing` is what the next GET /bluetooth/monitor says. */
async function fakePhonePairing(page: Page) {
  const report: { pairing: object } = { pairing: { state: 'idle' } };
  const asked: string[] = [];
  await page.route('http://127.0.0.1:7341/bluetooth/**', (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST') {
      asked.push(path);
      return route.fulfill({ status: 200, json: {} });
    }
    return route.fulfill({
      json: {
        adapter: null,
        phones: [],
        presenceChecking: false,
        devices: [],
        nearby: 0,
        verbose: false,
        log: [],
        ...report
      }
    });
  });
  return { report, asked };
}

/** That each element is wholly on the screen, so nothing on the page needs scrolling to. */
async function expectOnScreen(page: Page, elements: Locator[]) {
  const { width, height } = page.viewportSize() ?? { width: 0, height: 0 };
  const boxes = await Promise.all(elements.map(element => element.boundingBox()));
  for (const box of boxes) {
    expect(box).not.toBeNull();
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(height);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
  }
}

const PHONE = { address: '1C:3C:78:F2:61:1D', name: 'Max’s iPhone' };

/** The Wi-Fi networks the Pi sees (GET /location/scan), as its service answers: countdown-api's example request's. */
const ACCESS_POINTS = locate.locate_request.wifi_access_points.map(point => ({
  macAddress: point.mac_address,
  signalStrength: point.signal_strength,
  ...(point.channel !== undefined && { channel: point.channel }),
  ...(point.age !== undefined && { age: point.age })
}));

test.describe('A new kiosk’s first-time setup', { tag: '@registration' }, () => {
  // A kiosk that has never registered (the other tests start set up: see playwright.config.ts).
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
    );
    // The Pi's kiosk service, which says what the screen is: the-max-mix's HDMI 1280x800 panel, with no backlight.
    await page.route('http://127.0.0.1:7341/screen', route =>
      route.fulfill({ json: { width: 1280, height: 800, brightness_control: false } })
    );
    await page.route('http://127.0.0.1:7341/wifi/networks', route =>
      route.fulfill({ json: { networks: [{ ssid: 'Home', signal: 80, security: 'WPA2', known: false }] } })
    );
    await page.route('http://127.0.0.1:7341/soloist/**', route => route.fulfill({ json: { state: 'playing' } }));
    await page.route('http://127.0.0.1:7341/location/scan', route =>
      route.fulfill({ json: { accessPoints: ACCESS_POINTS } })
    );
  });

  for (const size of [
    { width: 1280, height: 800 },
    { width: 1024, height: 600 }
  ]) {
    test(`walks through every chapter from one QR code at ${size.width}x${size.height}`, async ({ page }, testInfo) => {
      await page.setViewportSize(size);
      const shot = async (name: string) =>
        testInfo.attach(`setup-${name}-${size.width}x${size.height}`, {
          body: await page.screenshot(),
          contentType: 'image/png'
        });
      let isOnline = false;
      await page.route('http://127.0.0.1:7341/wifi/status', route =>
        route.fulfill({ json: isOnline ? { ssid: 'Home', address: 'kiosk.local' } : { ssid: null, address: null } })
      );
      const server = await fakePairing(page);
      await page.goto('/?kiosk=1');
      // The welcome says what is coming, and Start opens the chapters.
      await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
      await shot('0-welcome');
      await page.getByRole('button', { name: 'Start' }).click();
      const chapters = page.getByRole('navigation', { name: 'Set up this screen' }).getByRole('listitem');
      await expect(chapters).toHaveText(['Wi-Fi', 'Account', 'Spotify', 'Soloist', 'Location', 'Presence']);

      // Wi-Fi: nothing registers on no network, and it moves on by itself once the Pi has joined one.
      await expect(page.getByRole('region', { name: 'Wi-Fi' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Next' })).toHaveCount(0);
      await shot('1-wifi');
      expect(server.registrations).toHaveLength(0);
      isOnline = true;

      // One QR code from here on. The kiosk registers and waits for its owner.
      const code = page.getByRole('img', { name: 'QR code to set up this screen on your phone' });
      await expect(page.getByRole('region', { name: 'Account' })).toBeVisible();
      await expect(code).toBeVisible();
      await expect.poll(() => server.accountAuthorizations.length).toBeGreaterThan(0);
      expect(server.registrations[0]).toMatchObject({ type: 'touchscreen', width: 1280, height: 800 });
      await shot('2-account');

      // Paired on the phone: the kiosk starts the Spotify sign-in the phone goes on to.
      const owned = await fakeCountdownServer(page, DEVICE_CONFIGS.owned);
      server.pair();
      await expect(page.getByRole('region', { name: 'Spotify' })).toBeVisible();
      // The phone was sent on, so the code is not shown again, only what happens there.
      await expect(page.getByText('Sign in to Spotify on your phone.')).toBeVisible();
      await expect(code).toHaveCount(0);
      await expect.poll(() => owned.spotifySignIns.started.length).toBe(1);
      await shot('3-spotify');
      await page.route('https://accounts.spotify.com/api/token', route =>
        route.fulfill({ json: { access_token: 'a', refresh_token: 'r', expires_in: 3600 } })
      );
      await page.route('https://api.spotify.com/v1/me', route =>
        route.fulfill({ json: { id: 'max', display_name: 'Max', images: [] } })
      );
      owned.spotifySignIns.phoneComesBack({ code: 'the-code' });

      // Signed in: the phone goes on to the Soloist key.
      const soloist = await fakeSignedOutSoloist(page);
      await expect(page.getByRole('region', { name: 'Soloist' })).toBeVisible();
      await expect(code).toHaveCount(0);
      await shot('4-soloist');
      // Whoever lost the page on their phone can have the code back.
      await page.getByRole('button', { name: 'Lost the page on your phone? Show the code again' }).click();
      await expect(code).toBeVisible();
      owned.soloistKeys.add('max');

      // The key starts Soloist, which signs in once they pick the kiosk in Spotify on their phone: the chapter waits.
      await expect(page.getByText('pick The Max Mix 1 in the device list')).toBeVisible({ timeout: 15_000 });
      await expect(code).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Soloist' })).toBeVisible();
      await shot('4b-spotify-pick');
      soloist.signIn();
      // The chapter says that Soloist is set up, and Presence opens at Continue.
      await expect(page.getByText('Soloist is set up and signed in to Spotify.')).toBeVisible({ timeout: 10_000 });
      await shot('4c-soloist-set');

      // Location: where the kiosk is was found in the background, from the Wi-Fi networks the Pi sees, while the owner
      // was on their phone, and the stops near it with it. The nearest postcode is the large one, the other nine under it.
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByRole('region', { name: 'Location' })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('Is this your postcode?')).toBeVisible();
      const nearest = page.getByRole('button', { name: 'SE17 2PU Our best guess' });
      const others = page.getByRole('list', { name: 'Or one of these nearby?' }).getByRole('button');
      await expect(nearest).toBeVisible();
      await expect(others).toHaveText(
        LOCATED.postcodes
          .slice(1)
          .map(near => near.postcode)
          .toSorted((a, b) => a.localeCompare(b))
      );
      await expect(page.getByRole('button', { name: 'Not here? Type it in' })).toBeVisible();
      expect(owned.located[0]).toEqual(locate.locate_request);
      const atGoogles = `?latitude=${locate.locate.latitude}&longitude=${locate.locate.longitude}`;
      expect(owned.near.length).toBeGreaterThan(0);
      expect(new Set(owned.near)).toEqual(new Set([atGoogles]));
      await shot('5-location');
      await expectOnScreen(page, [
        nearest,
        ...(await others.all()),
        page.getByRole('button', { name: 'Skip for now' })
      ]);
      expect((await others.first().boundingBox())?.height).toBeGreaterThanOrEqual(56);

      // A postcode picked is the notice board's, and the weather's place; the stops near it, none ticked, are those
      // found in the background, with no second ask: three stations and five bus stops at most, side by side.
      const asked = owned.near.length;
      await nearest.click();
      const stations = page.getByRole('region', { name: 'Stations' }).getByRole('button');
      const busStops = page.getByRole('region', { name: 'Bus stops' }).getByRole('button');
      await expect(page.getByText('Your nearest stops')).toBeVisible();
      await expect(busStops).toHaveCount(5);
      await expect(stations).toHaveCount(3);
      await expect(busStops.first()).toContainText('Westmoreland Road');
      await expect(busStops.first()).toContainText('140 m');
      await expect(busStops.first()).toHaveAttribute('aria-pressed', 'false');
      await expect(stations.first()).toContainText('Kennington');
      expect(owned.near).toHaveLength(asked);
      expect(owned.saves.at(-2)).toMatchObject({
        notice_board: { postcode: 'SE17 2PU', country: 'GB', address: null }
      });
      expect(owned.saves.at(-1)).toMatchObject({ weather: { location: 'Oslo', key: 'oslo-no-3143244' } });
      const continueButton = page.getByRole('button', { name: 'Continue' });
      await shot('5b-location-stops');
      await expectOnScreen(page, [...(await stations.all()), ...(await busStops.all()), continueButton]);
      await busStops.first().click();
      await stations.first().click();
      await expect(busStops.first()).toHaveAttribute('aria-pressed', 'true');
      await shot('5c-location-stops-picked');

      // What was set, and that Settings changes it.
      await continueButton.click();
      await expect(page.getByText('You’re all set!')).toBeVisible();
      await expect(page.getByText('2 stops')).toBeVisible();
      expect(owned.saves.at(-1)).toMatchObject({
        arrivals: {
          stops: [
            { source: 'tfl', id: '490014501K' },
            { source: 'tfl', id: '940GZZLUKNG' }
          ],
          group_by_route: false
        }
      });
      await shot('5d-location-set');

      // Presence: the scan only starts once they have Bluetooth open and tap OK.
      const bluetooth = await fakePhonePairing(page);
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByRole('region', { name: 'Presence' })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('Open Settings, then Bluetooth, on your phone, and tap OK.')).toBeVisible();
      await shot('5-presence');
      expect(bluetooth.asked).toEqual([]);
      bluetooth.report.pairing = { state: 'scanning', secondsLeft: 100, nearby: [PHONE] };
      await page.getByRole('button', { name: 'OK' }).click();
      await expect(page.getByRole('button', { name: PHONE.name })).toBeVisible();
      expect(bluetooth.asked).toContain('/bluetooth/pair-phone');
      await shot('6-presence-scanning');
      await page.getByRole('button', { name: PHONE.name }).click();
      bluetooth.report.pairing = { state: 'paired', name: PHONE.name, address: PHONE.address };
      await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
      await expect(page.getByText('Setup complete')).toBeVisible();
      await shot('7-done');

      // Done opens the app, and the next start doesn't come back to the wizard.
      await page.getByRole('button', { name: 'Done' }).click();
      await expect(page.getByRole('tabpanel', { name: 'Dashboard' })).toBeVisible();
      expect(await page.evaluate(() => localStorage.getItem('maxmix.setupDone'))).toBe('1');
      expect(await page.evaluate(() => localStorage.getItem('maxmix.setupLocationDone'))).toBe('1');
    });
  }
});
