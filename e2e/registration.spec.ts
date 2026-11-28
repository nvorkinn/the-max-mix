import { expect, test } from '@playwright/test';
import type { Locator, Page, Route } from '@playwright/test';
import { DEVICE_CONFIGS, fakeCountdownServer, fakeSetup, SPOTIFY_REDIRECT } from './fake-countdown.ts';
import { fakeSignedOutSoloist } from './fake-soloist.ts';
import { PIXEL } from './fake-spotify.ts';

// countdown-server's screens' API, as the build names it (.env.production).
const API = 'https://api.countdown.build';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT'
};
const SETUP = `${API}/api/devices/setup`;
const CODE = 'QR code to set up this screen on your phone';

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
        ? {
            status: 200,
            headers: CORS,
            json: { parcel: { linked: false }, spotify: { linked: false }, nrk: { linked: false } }
          }
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

/** Spotify's own answers to the kiosk: the tokens for a code, and whose they are. Returns each token request's form. */
async function fakeSpotifyAccount(page: Page) {
  const exchanges: URLSearchParams[] = [];
  await page.route('https://accounts.spotify.com/api/token', route => {
    exchanges.push(new URLSearchParams(route.request().postData() ?? ''));
    return route.fulfill({ json: { access_token: 'a', refresh_token: 'r', expires_in: 3600 } });
  });
  await page.route('https://api.spotify.com/v1/me', route =>
    route.fulfill({ json: { id: 'max', display_name: 'Max', images: [] } })
  );
  return exchanges;
}

/** Pairs the phone on Presence: the scan only starts once they have Bluetooth open and tap OK. Ends on Done. */
async function pairPhone(page: Page, bluetooth: Awaited<ReturnType<typeof fakePhonePairing>>, shot: Shot) {
  await expect(page.getByRole('region', { name: 'Presence' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Open Settings, then Bluetooth, on your phone, and tap OK.')).toBeVisible();
  await shot('6-presence');
  expect(bluetooth.asked).toEqual([]);
  bluetooth.report.pairing = { state: 'scanning', secondsLeft: 100, nearby: [PHONE] };
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('button', { name: PHONE.name })).toBeVisible();
  expect(bluetooth.asked).toContain('/bluetooth/pair-phone');
  await shot('6b-presence-scanning');
  await page.getByRole('button', { name: PHONE.name }).click();
  bluetooth.report.pairing = { state: 'paired', name: PHONE.name, address: PHONE.address };
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
  await expect(page.getByText('Setup complete')).toBeVisible();
  await shot('7-done');
}

type Shot = (name: string) => Promise<void>;

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
    test(`walks through every chapter in step with the phone at ${size.width}x${size.height}`, async ({
      page
    }, testInfo) => {
      await page.setViewportSize(size);
      const shot: Shot = async name => {
        await testInfo.attach(`setup-${name}-${size.width}x${size.height}`, {
          body: await page.screenshot(),
          contentType: 'image/png'
        });
      };
      let isOnline = false;
      await page.route('http://127.0.0.1:7341/wifi/status', route =>
        route.fulfill({ json: isOnline ? { ssid: 'Home', address: 'kiosk.local' } : { ssid: null, address: null } })
      );
      const server = await fakePairing(page);
      // The rest of the server, once someone owns the kiosk.
      const rest: { server?: Awaited<ReturnType<typeof fakeCountdownServer>> } = {};
      const setup = await fakeSetup(page, rest);
      const exchanges = await fakeSpotifyAccount(page);
      await page.goto('/?kiosk=1');
      // The welcome says what is coming, and Start opens the chapters.
      await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
      await shot('0-welcome');
      await page.getByRole('button', { name: 'Start' }).click();
      const chapters = page.getByRole('navigation', { name: 'Set up this screen' }).getByRole('listitem');
      await expect(chapters).toHaveText(['Wi-Fi', 'Account', 'Spotify', 'Soloist', 'Location', 'Presence']);

      // Wi-Fi: nothing registers or reports on no network, and it moves on by itself once the Pi has joined one.
      await expect(page.getByRole('region', { name: 'Wi-Fi' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Next' })).toHaveCount(0);
      await shot('1-wifi');
      expect(server.registrations).toHaveLength(0);
      expect(setup.reports).toHaveLength(0);
      isOnline = true;

      // One QR code from here on. The kiosk registers, tells the server what its first person's Spotify sign-in asks
      // for (the challenge of a verifier it keeps), and waits for its owner.
      const code = page.getByRole('img', { name: CODE });
      await expect(page.getByRole('region', { name: 'Account' })).toBeVisible();
      await expect(code).toBeVisible();
      await expect.poll(() => server.accountAuthorizations.length).toBeGreaterThan(0);
      expect(server.registrations[0]).toMatchObject({ type: 'touchscreen', width: 1280, height: 800 });
      await expect.poll(() => setup.reports.length).toBeGreaterThan(0);
      const verifier = await page.evaluate(() => localStorage.getItem('maxmix.setupVerifier'));
      expect(verifier).toMatch(/^[\w-]{43,128}$/);
      const challenge = setup.reports[0]?.spotify?.code_challenge;
      expect(challenge).toMatch(/^[\w-]{43}$/);
      expect(setup.reports[0]?.spotify?.scope).toContain('user-read-playback-state');
      expect(setup.step()).toBe('account');
      await shot('2-account');

      // Paired on the phone: both are on Spotify. The kiosk starts no sign-in of its own, and the same verifier is
      // still there after the page reloaded.
      const owned = await fakeCountdownServer(page, DEVICE_CONFIGS.owned, { hasAccount: true });
      rest.server = owned;
      server.pair();
      setup.phone.pair();
      await expect(page.getByRole('region', { name: 'Spotify' })).toBeVisible();
      // The phone was sent on, so the code is not shown again, only what happens there.
      await expect(page.getByText('Sign in to Spotify on your phone.')).toBeVisible();
      await expect(code).toHaveCount(0);
      await shot('3-spotify');
      // The server makes the sign-in when the phone gets there, and the kiosk finishes it once the phone is back from
      // Spotify, with the verifier it kept and where Spotify sent the phone.
      const soloist = await fakeSignedOutSoloist(page);
      setup.phone.goesToSpotify();
      setup.phone.comesBackFromSpotify({ code: 'the-code' });

      // Signed in: the kiosk asks for the Soloist key code at once, which moves both on to the key.
      await expect(page.getByRole('region', { name: 'Soloist' })).toBeVisible();
      await expect(page.getByText('Soloist needs an API key from you.')).toBeVisible();
      expect(owned.spotifySignIns.started).toHaveLength(0);
      expect(exchanges).toHaveLength(1);
      expect(exchanges[0]?.get('code')).toBe('the-code');
      expect(exchanges[0]?.get('code_verifier')).toBe(verifier);
      expect(exchanges[0]?.get('redirect_uri')).toBe(SPOTIFY_REDIRECT);
      expect(setup.reports.every(report => report.spotify?.code_challenge === challenge)).toBe(true);
      expect(await page.evaluate(() => localStorage.getItem('maxmix.setupVerifier'))).toBeNull();
      expect(owned.soloistCodes).toContain('max');
      await expect(code).toHaveCount(0);
      await shot('4-soloist');
      // Whoever lost the page on their phone can have the code back.
      await page.getByRole('button', { name: 'Lost the page on your phone? Show the code again' }).click();
      await expect(code).toBeVisible();
      setup.phone.savesKey('max');

      // The key starts Soloist, which signs in once they pick the kiosk in Spotify on their phone. The server is told
      // what Soloist is called, for the phone to say which device to pick.
      await expect(page.getByText('pick The Max Mix 1 in the device list')).toBeVisible({ timeout: 15_000 });
      await expect(code).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Soloist' })).toBeVisible();
      await expect.poll(() => setup.reports.some(report => report.soloist_device === 'The Max Mix 1')).toBe(true);
      await shot('4b-spotify-pick');
      soloist.signIn();

      // Soloist is signed in, which the kiosk tells the server: both go on to Location, with nothing to tap here.
      await expect(page.getByRole('region', { name: 'Location' })).toBeVisible({ timeout: 10_000 });
      expect(setup.reports.some(report => report.soloist_signed_in === true)).toBe(true);
      const lead = page.getByText('Tell us where the tablet is on your phone');
      const lost = page.getByRole('button', { name: 'Lost the page on your phone? Show the code again' });
      await expect(lead).toBeVisible();
      await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Skip for now' })).toHaveCount(0);
      await shot('5-location');
      await expectOnScreen(page, [lead, lost]);
      await lost.click();
      await expect(code).toBeVisible();
      await shot('5b-location-code');
      await expectOnScreen(page, [lead, code]);

      // Location is saved (or skipped) on the phone, and the kiosk gets its config again.
      const bluetooth = await fakePhonePairing(page);
      if (size.width === 1280) {
        setup.phone.savesLocation({ notice_board: { postcode: 'SE17 2PU', country: 'GB', address: null } });
        await expect.poll(() => page.evaluate(() => localStorage.getItem('maxmix.deviceConfig'))).toContain('SE17 2PU');
      } else {
        setup.phone.skipsLocation();
      }

      // Presence, which the server hears of once the phone is paired.
      await pairPhone(page, bluetooth, shot);
      await expect.poll(() => setup.step()).toBe('done');
      await expect(chapters).toHaveClass(Array.from({ length: 6 }, () => /is-done/));

      // Done tells the server, opens the app, and the next start doesn't come back to the wizard.
      await page.getByRole('button', { name: 'Done' }).click();
      await expect(page.getByRole('tabpanel', { name: 'Dashboard' })).toBeVisible();
      expect(setup.reports).toContainEqual({ finished: true });
      expect(await page.evaluate(() => localStorage.getItem('maxmix.setupDone'))).toBe('1');
    });
  }

  test('goes by itself, with no Location chapter, on a server that does not follow setups', async ({
    page
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const shot: Shot = async name => {
      await testInfo.attach(`setup-unfollowed-${name}-1280x800`, {
        body: await page.screenshot(),
        contentType: 'image/png'
      });
    };
    await page.route('http://127.0.0.1:7341/wifi/status', route =>
      route.fulfill({ json: { ssid: 'Home', address: 'kiosk.local' } })
    );
    const server = await fakePairing(page);
    // The server as it is before it follows setups: no such route, so 404 for the preflight of a call with the
    // secret too, which fails that call in the browser as the network would (Playwright answers a preflight itself,
    // so the call is failed here). Only an ask with nothing to preflight is answered: 404.
    const setupAsks: string[] = [];
    await page.route(SETUP, route => {
      const request = route.request();
      const hasSecret = request.headers()['authorization'] !== undefined;
      setupAsks.push(`${request.method()}${hasSecret ? ' with the secret' : ''}`);
      return hasSecret
        ? route.abort('failed')
        : route.fulfill({ status: 404, headers: CORS, contentType: 'text/html', body: 'Not Found' });
    });
    await fakeSpotifyAccount(page);
    await page.goto('/?kiosk=1');
    await page.getByRole('button', { name: 'Start' }).click();
    const chapters = page.getByRole('navigation', { name: 'Set up this screen' }).getByRole('listitem');
    const code = page.getByRole('img', { name: CODE });
    await expect(page.getByRole('region', { name: 'Account' })).toBeVisible();
    await expect(code).toBeVisible();
    // Once the server has turned the setup's routes down, Location is gone: it is set in Settings.
    await expect(chapters).toHaveText(['Wi-Fi', 'Account', 'Spotify', 'Soloist', 'Presence']);
    expect(setupAsks).toContain('GET');
    await expect.poll(() => server.accountAuthorizations.length).toBeGreaterThan(0);
    await shot('2-account');

    // Paired on the phone: the kiosk starts the Spotify sign-in the phone goes on to.
    const owned = await fakeCountdownServer(page, DEVICE_CONFIGS.owned, { hasAccount: true });
    server.pair();
    await expect(page.getByRole('region', { name: 'Spotify' })).toBeVisible();
    await expect(page.getByText('Sign in to Spotify on your phone.')).toBeVisible();
    await expect(chapters).toHaveText(['Wi-Fi', 'Account', 'Spotify', 'Soloist', 'Presence']);
    await expect(code).toHaveCount(0);
    await expect.poll(() => owned.spotifySignIns.started.length).toBe(1);
    owned.spotifySignIns.phoneComesBack({ code: 'the-code' });

    // Signed in: the phone goes on to the Soloist key.
    const soloist = await fakeSignedOutSoloist(page);
    await expect(page.getByRole('region', { name: 'Soloist' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('maxmix.setupVerifier'))).toBeNull();
    owned.soloistKeys.add('max');
    await expect(page.getByText('pick The Max Mix 1 in the device list')).toBeVisible({ timeout: 15_000 });
    soloist.signIn();
    // The chapter says that Soloist is set up, and Presence opens at Continue.
    await expect(page.getByText('Soloist is set up and signed in to Spotify.')).toBeVisible({ timeout: 10_000 });
    await shot('4c-soloist-set');
    const bluetooth = await fakePhonePairing(page);
    await page.getByRole('button', { name: 'Continue' }).click();
    await pairPhone(page, bluetooth, shot);
    await expect(page.getByRole('region', { name: 'Location' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('tabpanel', { name: 'Dashboard' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('maxmix.setupDone'))).toBe('1');
  });
});
