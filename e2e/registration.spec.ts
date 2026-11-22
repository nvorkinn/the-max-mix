import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
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
  let paired = false;
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
    return paired
      ? route.fulfill({ status: 200, headers: CORS, json: { parcel: { linked: false }, spotify: { linked: false } } })
      : route.fulfill({ status: 409, headers: CORS, json: { error: "the device isn't paired yet" } });
  });
  return {
    registrations,
    accountAuthorizations,
    pair: () => {
      paired = true;
    }
  };
}

test.describe('Adding a new kiosk to countdown-server', { tag: '@registration' }, () => {
  // A kiosk that has never registered (the other tests start registered: see playwright.config.ts).
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
    );
    // The Pi's kiosk service, which says what the screen is: the-max-mix's HDMI 1280x800 panel, with no backlight.
    await page.route('http://127.0.0.1:7341/screen', route =>
      route.fulfill({ json: { width: 1280, height: 800, brightness_control: false } })
    );
  });

  test('a new kiosk shows a QR code until someone owns it, then opens the app', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const server = await fakePairing(page);
    await page.goto('/?kiosk=1');

    const code = page.getByRole('img', { name: 'QR code to add this screen to your account' });
    await expect(code).toBeVisible();
    await testInfo.attach('pairing-1280x800', { body: await page.screenshot(), contentType: 'image/png' });

    // Registered as a touchscreen nobody owns, and asking with its secret whether someone does.
    await expect.poll(() => server.accountAuthorizations.length).toBeGreaterThan(0);
    const secret = await page.evaluate(() => localStorage.getItem('maxmix.deviceSecret'));
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(server.registrations[0]).toEqual({
      secret,
      type: 'touchscreen',
      width: 1280,
      height: 800,
      brightness_control: false
    });
    expect(server.accountAuthorizations[0]).toBe(`Bearer ${secret}`);
    expect(await page.evaluate(() => localStorage.getItem('maxmix.deviceId'))).toBeNull();

    // Someone scans it and signs in on their phone: the kiosk keeps its device ID and opens the app.
    server.pair();
    await expect(code).toBeHidden();
    await expect(page.getByRole('tabpanel', { name: 'Dashboard' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('maxmix.deviceId'))).toBe('0a1b2c3d4e5f');
    expect(await page.evaluate(() => localStorage.getItem('maxmix.deviceSecret'))).toBe(secret);

    // Owned: the next start opens the app without registering again.
    const registered = server.registrations.length;
    await page.goto('/?kiosk=1');
    await expect(page.getByRole('tabpanel', { name: 'Dashboard' })).toBeVisible();
    await expect(code).toBeHidden();
    expect(server.registrations).toHaveLength(registered);
  });

  test('a kiosk whose Pi cannot say what its screen is opens the app unregistered', async ({ page }) => {
    await page.route('http://127.0.0.1:7341/screen', route => route.fulfill({ status: 503 }));
    const server = await fakePairing(page);
    await page.goto('/?kiosk=1');

    await expect(page.getByRole('tabpanel', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'QR code to add this screen to your account' })).toBeHidden();
    expect(server.registrations).toHaveLength(0);
    expect(await page.evaluate(() => localStorage.getItem('maxmix.deviceId'))).toBeNull();
  });
});
