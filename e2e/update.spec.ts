import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { fakeSpotify, PIXEL } from './fake-spotify.ts';
import { showSection } from './settings.ts';

const UPDATE_SOCKET = 'ws://127.0.0.1:7341/power/update';

/** What the kiosk service sends while it updates (pi/kiosk-audio/update.ts). */
const send = (ws: WebSocketRoute, message: object) => {
  ws.send(JSON.stringify(message));
};
const logLine = (line: string) => ({ type: 'log', line: `2026-11-04T20:00:00+0000 kiosk-update[1]: ${line}` });

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Private-Network': 'true' };

/**
 * The kiosk as the app sees it: the Pi runs v1.12.0, and its service says `channel.newest` is the newest version on its
 * update channel (change it while the test runs to make a newer one "come out"). Nothing else answers the kiosk service
 * unless a test serves its socket.
 */
async function openKiosk(page: Page, newest: string) {
  const channel = { newest };
  await page.route('http://127.0.0.1:7341/update/check', route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const current = 'v1.12.0+5a39e9a0';
    const latest = `${channel.newest}+${channel.newest === 'v1.12.0' ? '5a39e9a0' : 'bbbbbbb0'}`;
    return route.fulfill({
      headers: CORS,
      json: {
        channel: 'stable',
        current,
        installed: null,
        failed: null,
        busy: false,
        result: latest === current ? 'up-to-date' : 'available',
        latest
      }
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem('maxmix.kiosk', 'true');
    localStorage.setItem('maxmix.piVersion', 'v1.12.0 5a39e9a');
  });
  await page.goto('/');
  return channel;
}

const popup = (page: Page) => page.getByRole('dialog', { name: 'Update available' });
const console_ = (page: Page) => page.getByRole('dialog', { name: 'Updating the Pi' });

test.describe('Software update', { tag: '@update' }, () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
    );
    await fakeSpotify(page);
  });

  test('asks about a newer release once, and Not now is remembered', async ({ page }) => {
    await openKiosk(page, 'v1.13.0');
    await expect(popup(page)).toBeVisible();
    await expect(popup(page)).toContainText('v1.13.0 is out.');
    await popup(page).getByRole('button', { name: 'Not now' }).click();
    await expect(popup(page)).toBeHidden();

    // Opening the page again checks the channel again, but does not ask the person.
    const checked = page.waitForResponse('http://127.0.0.1:7341/update/check');
    await page.reload();
    await checked;
    await expect(page.getByRole('tabpanel', { name: 'Dashboard' })).toBeVisible();
    await expect(popup(page)).toBeHidden();

    // Settings still say it, and the check button beside it asks again.
    await page.getByRole('tab', { name: 'Settings' }).click();
    const settings = page.getByRole('tabpanel', { name: 'Settings' });
    await showSection(settings, 'About');
    await expect(settings.getByRole('status')).toContainText('v1.13.0 is out.');
    await expect(popup(page)).toBeHidden();
    await settings.getByRole('button', { name: 'Check for updates' }).click();
    await expect(popup(page)).toBeVisible();
    await popup(page).getByRole('button', { name: 'Not now' }).click();
    await expect(settings.getByRole('status')).toContainText('v1.13.0 is out.');
  });

  test('the update popup appears over Settings, where it can be read and tapped', async ({ page }) => {
    // The Pi runs v1.12.0 and its channel first says that is the newest, so nothing is asked when the page starts.
    const channel = await openKiosk(page, 'v1.12.0');
    await page.getByRole('tab', { name: 'Settings' }).click();
    const settings = page.getByRole('tabpanel', { name: 'Settings' });
    await showSection(settings, 'About');
    await expect(settings.getByRole('status')).toContainText('Up to date as of');

    // A newer release comes out while the tablet runs; opening Settings again checks and finds it, with Settings open.
    channel.newest = 'v1.13.0';
    await page.getByRole('tab', { name: 'Spotify' }).click();
    // Each tab has its own bar, so the next tap waits for the Spotify tab's.
    await expect(settings).toBeHidden();
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(popup(page)).toBeVisible();
    await expect(settings).toBeVisible();

    // Whatever is at the popup's middle must be the popup (or part of it), not Settings behind it.
    await expect
      .poll(() =>
        popup(page).evaluate(element => {
          const box = element.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return element.contains(hit);
        })
      )
      .toBe(true);
    await expect(popup(page).getByRole('button', { name: 'Not now' })).toBeInViewport({ ratio: 1 });

    // Playwright only clicks what receives the click, so this fails if Settings were over the popup.
    await popup(page).getByRole('button', { name: 'Not now' }).click();
    await expect(popup(page)).toBeHidden();
    await expect(settings).toBeVisible();
  });

  test('Update now streams the update into a full-screen console until it finishes', async ({ page }) => {
    const finish = Promise.withResolvers<undefined>();
    await page.routeWebSocket(UPDATE_SOCKET, ws => {
      send(ws, { type: 'status', state: 'installing' });
      send(ws, logLine('Installing v1.13.0+bbbbbbb0'));
      send(ws, logLine('Update progress: 30% Copying slot'));
      void finish.promise.then(() => {
        send(ws, { type: 'status', state: 'done', message: 'Nothing needed a restart.' });
        void ws.close({ code: 1000 });
      });
    });
    await openKiosk(page, 'v1.13.0');
    await popup(page).getByRole('button', { name: 'Update now' }).click();

    const updating = console_(page);
    await expect(updating).toBeVisible();
    const output = updating.getByLabel('Update output');
    await expect(output).toContainText('Installing v1.13.0+bbbbbbb0');
    await expect(updating.getByRole('status')).toContainText('Installing the update…');
    // RAUC's progress lines move the bar and stay out of the output.
    await expect(updating.getByRole('progressbar', { name: '30% installed' })).toHaveAttribute('value', '30');
    await expect(output).not.toContainText('Update progress');
    // The console covers the screen, and there is nothing to go back to while the update runs.
    await expect(updating).toBeInViewport({ ratio: 1 });
    await expect(updating.getByRole('button', { name: 'Close update console' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(updating).toBeVisible();

    finish.resolve(undefined);
    await expect(updating.getByRole('status')).toContainText('Update finished. Nothing needed a restart.');
    await updating.getByRole('button', { name: 'Close update console' }).click();
    await expect(updating).toBeHidden();
    await expect(page.getByRole('tabpanel', { name: 'Dashboard' })).toBeVisible();
  });

  test('an update that restarts the kiosk leaves the console up, with no way back', async ({ page }) => {
    await page.routeWebSocket(UPDATE_SOCKET, ws => {
      send(ws, { type: 'status', state: 'installing' });
      send(ws, logLine('Installed v1.13.0+bbbbbbb0'));
      send(ws, { type: 'status', state: 'restarting' });
      // The restart ends the browser the app runs in, so the service's connection simply goes away.
      void ws.close({ code: 1006 });
    });
    await openKiosk(page, 'v1.13.0');
    await popup(page).getByRole('button', { name: 'Update now' }).click();

    const updating = console_(page);
    await expect(updating.getByRole('status')).toContainText('Restarting the kiosk…');
    await expect(updating.getByLabel('Update output')).toContainText('Installed v1.13.0+bbbbbbb0');
    await expect(updating.getByRole('button', { name: 'Close update console' })).toHaveCount(0);
  });

  test('a failed update says why, shows the output and can be closed', async ({ page }) => {
    await page.routeWebSocket(UPDATE_SOCKET, ws => {
      send(ws, { type: 'status', state: 'installing' });
      send(ws, logLine('Failed to download bundle: could not resolve host github.com'));
      send(ws, { type: 'error', line: 'No journal files were opened due to insufficient permissions.' });
      send(ws, { type: 'status', state: 'failed', message: 'kiosk-update ended with status 2.' });
      void ws.close({ code: 1000 });
    });
    await openKiosk(page, 'v1.13.0');
    await popup(page).getByRole('button', { name: 'Update now' }).click();

    const updating = console_(page);
    await expect(updating.getByRole('status')).toContainText('The update failed. kiosk-update ended with status 2.');
    await expect(updating.getByLabel('Update output')).toContainText('could not resolve host');
    await expect(updating.getByLabel('Update output')).toContainText('No journal files were opened');
    await updating.getByRole('button', { name: 'Close update console' }).click();
    await expect(updating).toBeHidden();
  });

  test('when the kiosk service does not answer, the console says so and can be closed', async ({ page }) => {
    // Nothing listens on the kiosk service's port in the test, which is how a Pi whose service is down looks.
    await openKiosk(page, 'v1.13.0');
    await popup(page).getByRole('button', { name: 'Update now' }).click();

    const updating = console_(page);
    await expect(updating.getByRole('status')).toContainText('The kiosk service is not answering.');
    await updating.getByRole('button', { name: 'Close update console' }).click();
    await expect(updating).toBeHidden();
  });

  test('Check for updates in Settings finds a newer release, and the popup opens the console over Settings', async ({
    page
  }) => {
    const connected = Promise.withResolvers<undefined>();
    await page.routeWebSocket(UPDATE_SOCKET, ws => {
      send(ws, { type: 'status', state: 'installing' });
      connected.resolve(undefined);
    });
    // Up to date when Settings open, so there is no popup.
    const channel = await openKiosk(page, 'v1.12.0');
    await page.getByRole('tab', { name: 'Settings' }).click();
    const settings = page.getByRole('tabpanel', { name: 'Settings' });
    await showSection(settings, 'About');
    await expect(settings.getByRole('status')).toContainText('Up to date as of');
    await expect(settings.getByRole('button', { name: 'Update now' })).toHaveCount(0);

    // A newer release comes out with Settings open: the check button finds it.
    channel.newest = 'v1.13.0';
    await settings.getByRole('button', { name: 'Check for updates' }).click();
    await expect(popup(page)).toContainText('v1.13.0 is out.');
    await popup(page).getByRole('button', { name: 'Update now' }).click();
    await connected.promise;
    await expect(console_(page)).toBeVisible();
  });
});
