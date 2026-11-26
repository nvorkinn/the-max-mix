import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { fakeCountdownServer } from './fake-countdown.ts';
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

const PHONE = { address: '1C:3C:78:F2:61:1D', name: 'Max’s iPhone' };

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
      await expect(chapters).toHaveText(['Wi-Fi', 'Account', 'Spotify', 'Soloist', 'Presence']);

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

      // Paired on the phone: the kiosk starts the Spotify sign-in the phone goes on to, under the same code.
      const owned = await fakeCountdownServer(page, {});
      server.pair();
      await expect(page.getByRole('region', { name: 'Spotify' })).toBeVisible();
      await expect(code).toBeVisible();
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
      await expect(code).toBeVisible();
      await shot('4-soloist');
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
    });
  }
});
