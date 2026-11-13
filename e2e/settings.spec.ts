import { expect, test, type Page } from '@playwright/test';
import { advance } from './clock.ts';
import { countPlaybackReads, fakeSpotify, PIXEL } from './fake-spotify.ts';

const openSettings = async (page: Page) => {
  await page.getByRole('button', { name: 'Open settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeVisible();
  return settings;
};

const openDebug = async (page: Page) => {
  await page.keyboard.press('Control+Shift+D');
  const debug = page.getByRole('dialog', { name: 'Debug console' });
  await expect(debug).toBeVisible();
  return debug;
};

test.describe('Settings', { tag: '@settings' }, () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 600 });
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
    );
    await fakeSpotify(page);
  });

  test('opens and closes', async ({ page }) => {
    await page.goto('/');
    const dialog = await openSettings(page);
    await dialog.getByRole('button', { name: 'Close settings' }).click();
    await expect(dialog).toBeHidden();
  });

  test('shows that Spotify is connected', async ({ page }) => {
    await page.goto('/');
    const dialog = await openSettings(page);
    await expect(dialog).toContainText('Spotify connection:');
    await expect(dialog).toContainText('Connected');
    await expect(dialog.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  test('the colour choice recolours the app and is kept', async ({ page }) => {
    await page.goto('/');
    const room = page.locator('.tablet-container');
    await expect(room).toHaveAttribute('data-colour', 'forest');
    const accent = () => room.evaluate(element => getComputedStyle(element).getPropertyValue('--accent').trim());
    const before = await accent();

    const dialog = await openSettings(page);
    await dialog.getByRole('button', { name: 'Navy' }).click();
    await expect(dialog.getByRole('button', { name: 'Navy' })).toHaveAttribute('aria-pressed', 'true');
    await expect(room).toHaveAttribute('data-colour', 'navy');
    expect(await accent()).not.toBe(before);

    await page.reload();
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
      await page.goto('/');
      await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
      // It is not a setting people are offered.
      const settings = await openSettings(page);
      await expect(settings).not.toContainText('Poll Spotify');
      await settings.getByRole('button', { name: 'Close settings' }).click();

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
      await page.goto('/');
      const dialog = await openSettings(page);
      const choices = dialog.getByRole('group', { name: 'Screen sleep' });
      // Five minutes is the default.
      await expect(choices.getByRole('button', { name: '5 min', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await choices.getByRole('button', { name: '15 min', exact: true }).click();
      await expect(choices.getByRole('button', { name: '15 min', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true'
      );

      await page.reload();
      const again = await openSettings(page);
      await expect(
        again.getByRole('group', { name: 'Screen sleep' }).getByRole('button', { name: '15 min', exact: true })
      ).toHaveAttribute('aria-pressed', 'true');
    });

    test('Wi-Fi names the network; it, Restart kiosk and Reboot Pi ask the kiosk service, the last two only on a second tap', async ({
      page
    }) => {
      const asked: string[] = [];
      await page.route('http://127.0.0.1:7341/**', route => {
        const { pathname } = new URL(route.request().url());
        // The app also sends its errors to the kiosk's log (POST /log) and reads which speakers play (GET); neither is
        // what is being asked about here.
        const method = route.request().method();
        if (method === 'POST' && pathname !== '/log') asked.push(`${method} ${pathname}`);
        const isStatus = method === 'GET' && pathname === '/wifi/status';
        return route.fulfill(
          isStatus
            ? { headers: { 'Access-Control-Allow-Origin': '*' }, json: { ssid: 'Home network' } }
            : { status: 204 }
        );
      });
      await page.goto('/');
      const dialog = await openSettings(page);

      await expect(dialog).toContainText('Home network');
      await dialog.getByRole('button', { name: 'Change network' }).click();
      await expect.poll(() => asked).toEqual(['POST /wifi']);

      await dialog.getByRole('button', { name: 'Restart kiosk' }).click();
      await expect(dialog.getByRole('button', { name: 'Tap again to restart' })).toBeVisible();
      expect(asked).toEqual(['POST /wifi']);
      await dialog.getByRole('button', { name: 'Tap again to restart' }).click();
      await expect.poll(() => asked).toEqual(['POST /wifi', 'POST /power/restart']);

      await dialog.getByRole('button', { name: 'Reboot Pi' }).click();
      await expect(dialog.getByRole('button', { name: 'Tap again to reboot' })).toBeVisible();
      expect(asked).toEqual(['POST /wifi', 'POST /power/restart']);
      await dialog.getByRole('button', { name: 'Tap again to reboot' }).click();
      await expect.poll(() => asked).toEqual(['POST /wifi', 'POST /power/restart', 'POST /power/reboot']);
    });
  });

  test('Sign out forgets the login, and signing in again goes to Spotify to approve once more', async ({ page }) => {
    await page.route('https://accounts.spotify.com/authorize**', route =>
      route.fulfill({ contentType: 'text/html', body: '<h1>Test sign-in page</h1>' })
    );
    await page.goto('/');
    const dialog = await openSettings(page);
    await dialog.getByRole('button', { name: 'Sign out' }).click();

    // The page reloads signed out, with nothing of the login kept.
    const connect = page.getByRole('button', { name: 'Connect Spotify' });
    await expect(connect).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('maxmix.auth'))).toBeNull();
    expect(await page.evaluate(() => sessionStorage.getItem('maxmix.pkce'))).toBeNull();

    // Spotify may remember the person and sign the same account in silently; this makes it show its page instead.
    await connect.click();
    await expect(page.getByRole('heading', { name: 'Test sign-in page' })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('show_dialog')).toBe('true');
  });

  test('the kiosk-only settings are not offered away from the kiosk', async ({ page }) => {
    await page.goto('/?kiosk=0');
    const dialog = await openSettings(page);
    await expect(dialog.getByRole('button', { name: 'Sign out' })).toBeVisible();
    const kioskOnly = ['Change network', 'Choose network', 'Restart kiosk', 'Reboot Pi', 'Check for updates'];
    await Promise.all(kioskOnly.map(name => expect(dialog.getByRole('button', { name })).toHaveCount(0)));
    await expect(dialog.getByRole('group', { name: 'Screen sleep' })).toHaveCount(0);
  });
});
