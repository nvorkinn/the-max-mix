import { expect, test, type Locator, type Page } from '@playwright/test';
import { getClientId } from '../src/spotify/settings.ts';
import { advance } from './clock.ts';
import { cameraAnswer, wifiAnswer } from './fake-kiosk.ts';
import { countPlaybackReads, fakeSpotify, PIXEL } from './fake-spotify.ts';
import { openSettings, showSection } from './settings.ts';
import { openSpotifyTab, showSpotifyTab } from './spotify-tab.ts';

const openDebug = async (page: Page) => {
  await page.keyboard.press('Control+Shift+D');
  const debug = page.getByRole('dialog', { name: 'Debug console' });
  await expect(debug).toBeVisible();
  return debug;
};

/** The chosen person's login, phone and removal, under the faces on the Spotify page: the group with a Remove button. */
const chosenPerson = (dialog: Locator) =>
  dialog
    .getByRole('group')
    .filter({ has: dialog.page().getByRole('button', { name: /^(Remove|Tap again to remove)$/ }) });

test.describe('Settings', { tag: '@settings' }, () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
    );
    await fakeSpotify(page);
  });

  test('opens on its first page and closes', async ({ page }) => {
    await openSpotifyTab(page);
    const dialog = await openSettings(page);
    const nav = dialog.getByRole('navigation', { name: 'Settings' });
    const first = nav.getByRole('button').first();
    await expect(first).toHaveAttribute('aria-current', 'page');
    await expect(dialog.getByRole('region', { name: (await first.textContent()) ?? '' })).toBeVisible();
    await page.getByRole('tab', { name: 'Spotify' }).click();
    await expect(dialog).toBeHidden();
  });

  test('every section opens from the navigation', async ({ page }) => {
    await openSpotifyTab(page, '/?kiosk=1');
    const dialog = await openSettings(page);
    const nav = dialog.getByRole('navigation', { name: 'Settings' });
    const sections = ['Wi-Fi', 'Screen', 'Appearance', 'Spotify', 'About'];
    await expect(nav.getByRole('button')).toHaveText(sections);
    for (const section of sections) {
      // eslint-disable-next-line no-await-in-loop -- one section after another
      await showSection(dialog, section);
      // eslint-disable-next-line no-await-in-loop -- the same
      await expect(nav.getByRole('button', { name: section, exact: true })).toHaveAttribute('aria-current', 'page');
    }
  });

  test('shows that Spotify is connected', async ({ page }) => {
    await openSpotifyTab(page);
    const dialog = await openSettings(page);
    await showSection(dialog, 'Spotify');
    // The one face, chosen, with its login, phone and removal under the faces.
    const face = dialog.getByRole('list', { name: 'People' }).getByRole('listitem').first().getByRole('button');
    await expect(face).toHaveAttribute('aria-pressed', 'true');
    const person = chosenPerson(dialog);
    await expect(person).toContainText('Connected');
    await expect(person.getByRole('button', { name: 'Remove' })).toBeVisible();
  });

  test('a revoked login stays listed as expired, and signing in again shows the code for a phone', async ({ page }) => {
    await page.route('https://accounts.spotify.com/api/token', route =>
      route.fulfill({ status: 400, json: { error: 'invalid_grant' } })
    );
    await page.addInitScript(clientId => {
      localStorage.setItem(
        'maxmix.people',
        JSON.stringify({
          clientId,
          activeId: 'friend',
          people: [{ spotifyId: 'friend', name: 'Friend', imageUrl: '', refreshToken: 'r', phoneAddress: '' }]
        })
      );
    }, getClientId());
    await page.goto('/?kiosk=0');
    const dialog = await openSettings(page, 'Spotify');
    await expect(dialog.getByRole('list', { name: 'People' }).getByRole('button', { name: 'Friend' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    const person = dialog.getByRole('group', { name: 'Friend' });
    await expect(person).toContainText('Expired');
    await person.getByRole('button', { name: 'Sign in' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Sign in to Spotify' }).getByRole('img', { name: 'Sign in to Spotify' })
    ).toBeVisible();
  });

  test('the colour choice recolours the app and is kept', async ({ page }) => {
    await openSpotifyTab(page);
    const room = page.locator('.tablet-container');
    await expect(room).toHaveAttribute('data-colour', 'forest');
    const accent = () => room.evaluate(element => getComputedStyle(element).getPropertyValue('--accent').trim());
    const before = await accent();

    const dialog = await openSettings(page, 'Appearance');
    await dialog.getByRole('button', { name: 'Navy' }).click();
    await expect(dialog.getByRole('button', { name: 'Navy' })).toHaveAttribute('aria-pressed', 'true');
    await expect(room).toHaveAttribute('data-colour', 'navy');
    expect(await accent()).not.toBe(before);

    await page.reload();
    await showSpotifyTab(page);
    await expect(room).toHaveAttribute('data-colour', 'navy');
    await expect(page.getByRole('heading', { name: 'One More Time' })).toBeVisible();
  });

  test.describe('Poll Spotify for updates, in the debug console', () => {
    test.beforeEach(async ({ page }) => {
      await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
      await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
    });

    test('unticked stops the timer reads, is kept across a reload, and ticked starts them again', async ({ page }) => {
      const reads = countPlaybackReads(page);
      await openSpotifyTab(page);
      await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
      // It is not a setting people are offered.
      const settings = await openSettings(page);
      await expect(settings).not.toContainText('Poll Spotify');
      await page.getByRole('tab', { name: 'Spotify' }).click();

      const debug = await openDebug(page);
      const poll = debug.getByRole('checkbox', { name: 'Poll Spotify for updates' });
      await expect(poll).toBeChecked();

      const awake = reads();
      await advance(page, 12_000);
      expect(reads() - awake).toBeGreaterThanOrEqual(2);

      await poll.uncheck();
      await advance(page, 1000);
      const stopped = reads();
      await advance(page, 30_000, 5000);
      expect(reads()).toBe(stopped);

      // Kept across a reload: the page reads once when it opens, and then not again.
      await page.reload();
      await showSpotifyTab(page);
      await expect(page.getByRole('heading', { name: 'One More Time' })).toBeVisible();
      const reloaded = reads();
      await advance(page, 30_000, 5000);
      expect(reads()).toBe(reloaded);
      const again = (await openDebug(page)).getByRole('checkbox', { name: 'Poll Spotify for updates' });
      await expect(again).not.toBeChecked();

      await again.check();
      const resumed = reads();
      await advance(page, 12_000);
      expect(reads() - resumed).toBeGreaterThanOrEqual(2);
    });
  });

  test.describe('on the kiosk', () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('maxmix.kiosk', 'true');
      });
    });

    test('Screen sleep keeps the choice across a reload', async ({ page }) => {
      await openSpotifyTab(page);
      const dialog = await openSettings(page, 'Screen');
      const choices = dialog.getByRole('group', { name: 'Screen sleep' });
      // Five minutes is the default.
      await expect(choices.getByRole('button', { name: '5 min', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await choices.getByRole('button', { name: '15 min', exact: true }).click();
      await expect(choices.getByRole('button', { name: '15 min', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true'
      );

      await page.reload();
      const again = await openSettings(page, 'Screen');
      await expect(
        again.getByRole('group', { name: 'Screen sleep' }).getByRole('button', { name: '15 min', exact: true })
      ).toHaveAttribute('aria-pressed', 'true');
    });

    test('Wi-Fi names the network, forgets it on a second tap, and joins another with its password', async ({
      page
    }) => {
      const joined: unknown[] = [];
      const forgotten: unknown[] = [];
      await page.route('http://127.0.0.1:7341/**', route => {
        const request = route.request();
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/wifi/connect') {
          joined.push(request.postDataJSON());
          return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: { ok: true } });
        }
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/wifi/forget') {
          forgotten.push(request.postDataJSON());
          return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: { ok: true } });
        }
        return route.fulfill(wifiAnswer(request, 'Home network') ?? { status: 204 });
      });
      await openSpotifyTab(page);
      const dialog = await openSettings(page);
      await showSection(dialog, 'Wi-Fi');
      await expect(dialog.getByTestId('wifi-network')).toHaveText('Home network');
      // The network it is on is at the top, not among the others, which come strongest first.
      const others = dialog.getByRole('region', { name: 'Other networks' }).getByRole('listitem');
      await expect(others).toHaveText(['Neighbour', 'Cafe guest', /^Old router/]);
      await dialog.getByRole('button', { name: 'Forget', exact: true }).click();
      expect(forgotten).toEqual([]);
      await dialog.getByRole('button', { name: 'Tap again to forget' }).click();
      await expect.poll(() => forgotten).toEqual([{ ssid: 'Home network' }]);
      await expect(dialog.getByRole('button', { name: /^Old router/ })).toBeDisabled();
      await dialog.getByRole('button', { name: /^Neighbour/ }).click();
      const join = page.getByRole('dialog', { name: 'Join Neighbour' });
      await join.getByLabel('Password').fill('secret123');
      await join.getByRole('button', { name: 'Connect' }).click();
      await expect(join).toBeHidden();
      expect(joined).toEqual([{ ssid: 'Neighbour', password: 'secret123', hidden: false, security: 'psk' }]);
    });

    test('Wi-Fi joins the network whose QR code is held up to the camera', async ({ page }) => {
      const joined: unknown[] = [];
      await page.route('http://127.0.0.1:7341/**', route => {
        const request = route.request();
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/wifi/connect') {
          joined.push(request.postDataJSON());
          return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: { ok: true } });
        }
        const answer = cameraAnswer(request, 'WIFI:T:WPA;S:Attic;P:battery staple;H:true;;');
        return route.fulfill(answer ?? wifiAnswer(request, 'Home network') ?? { status: 204 });
      });
      await openSpotifyTab(page);
      const dialog = await openSettings(page);
      await showSection(dialog, 'Wi-Fi');
      await dialog.getByRole('button', { name: 'Scan code' }).click();
      const scan = page.getByRole('dialog', { name: 'Show the Wi-Fi’s QR code' });
      // The page reads the code out of the picture itself, with the decoder it ships, and says how the join went.
      await expect(scan.getByRole('status')).toHaveText('Successfully connected to Attic.');
      await scan.getByRole('button', { name: 'Continue' }).click();
      await expect(scan).toBeHidden();
      expect(joined).toEqual([{ ssid: 'Attic', password: 'battery staple', hidden: true, security: 'psk' }]);
    });

    test('Restart kiosk and Reboot Pi ask the kiosk service, only on a second tap', async ({ page }) => {
      const asked: string[] = [];
      await page.route('http://127.0.0.1:7341/**', route => {
        const { pathname } = new URL(route.request().url());
        // The app also sends its errors to the kiosk's log (POST /log), hands its saved data over (POST /handover), asks
        // an image Pi's update channel (POST /update/check) and reads which speakers play (GET); none is what is being
        // asked about here.
        const method = route.request().method();
        const isOther = ['/log', '/handover', '/update/check'].includes(pathname);
        if (method === 'POST' && !isOther) asked.push(`${method} ${pathname}`);
        return route.fulfill({ status: 204 });
      });
      await openSpotifyTab(page);
      const dialog = await openSettings(page);
      await showSection(dialog, 'About');

      await dialog.getByRole('button', { name: 'Restart kiosk' }).click();
      await expect(dialog.getByRole('button', { name: 'Tap again to restart' })).toBeVisible();
      expect(asked).toEqual([]);
      await dialog.getByRole('button', { name: 'Tap again to restart' }).click();
      await expect.poll(() => asked).toEqual(['POST /power/restart']);

      await dialog.getByRole('button', { name: 'Reboot Pi' }).click();
      await expect(dialog.getByRole('button', { name: 'Tap again to reboot' })).toBeVisible();
      expect(asked).toEqual(['POST /power/restart']);
      await dialog.getByRole('button', { name: 'Tap again to reboot' }).click();
      await expect.poll(() => asked).toEqual(['POST /power/restart', 'POST /power/reboot']);
    });
  });

  test('removing the last person forgets the login', async ({ page }) => {
    await openSpotifyTab(page);
    const dialog = await openSettings(page, 'Spotify');
    const person = chosenPerson(dialog);
    await person.getByRole('button', { name: 'Remove' }).click();
    await person.getByRole('button', { name: 'Tap again to remove' }).click();

    // The page reloads signed out, on the Dashboard as every start does, with nothing of the login kept.
    await expect(page.getByRole('tab', { name: 'Dashboard' })).toHaveAttribute('aria-selected', 'true');
    await showSpotifyTab(page);
    const connect = page.getByRole('button', { name: 'Connect Spotify' });
    await expect(connect).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('maxmix.people'))).toBeNull();
  });

  test('the kiosk-only settings are not offered away from the kiosk', async ({ page }) => {
    await openSpotifyTab(page, '/?kiosk=0');
    const dialog = await openSettings(page);
    await expect(dialog.getByRole('navigation', { name: 'Settings' }).getByRole('button')).toHaveText([
      'Appearance',
      'Spotify',
      'About'
    ]);
    await expect(dialog.getByRole('button', { name: /^(Wi-Fi|General)/ })).toHaveCount(0);
    await showSection(dialog, 'About');
    await expect(dialog).toContainText('App version');
    await dialog.getByRole('button', { name: 'Debug console' }).click();
    const debug = page.getByRole('dialog', { name: 'Debug console' });
    await expect(debug).toBeVisible();
    await debug.getByRole('button', { name: 'Close debug console' }).click();
    await expect(debug).toBeHidden();
    await showSection(dialog, 'Spotify');
    await expect(dialog.getByRole('button', { name: 'Remove' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /phone/ })).toHaveCount(0);
    const kioskOnly = ['Type a network', 'Restart kiosk', 'Reboot Pi', 'Check for updates'];
    await Promise.all(kioskOnly.map(name => expect(dialog.getByRole('button', { name })).toHaveCount(0)));
  });
});
