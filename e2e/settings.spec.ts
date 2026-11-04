import { expect, test, type Page } from '@playwright/test';
import { advance } from './clock.ts';
import { countPlaybackReads, fakeSpotify } from './fake-spotify.ts';

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

const openSettings = async (page: Page) => {
  await page.getByRole('button', { name: 'Open settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeVisible();
  return settings;
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

  test.describe('Poll Spotify for updates', () => {
    test.beforeEach(async ({ page }) => {
      await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
      await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
    });

    test('Off stops the timer reads, is kept across a reload, and On starts them again', async ({ page }) => {
      const reads = countPlaybackReads(page);
      await page.goto('/');
      await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
      const dialog = await openSettings(page);
      const choice = dialog.getByRole('group', { name: 'Poll Spotify for updates' });
      await expect(choice.getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'true');
      await expect(dialog).toContainText('On: playback and the queue are read every few seconds');

      const awake = reads();
      await advance(page, 12_000);
      expect(reads() - awake).toBeGreaterThanOrEqual(2);

      await choice.getByRole('button', { name: 'Off' }).click();
      await expect(choice.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
      await expect(dialog).toContainText('Off: playback is read when the page opens');
      await advance(page, 1000);
      const stopped = reads();
      await advance(page, 30_000);
      expect(reads()).toBe(stopped);

      // Kept across a reload: the page reads once when it opens, and then not again.
      await page.reload();
      await expect(page.getByRole('heading', { name: 'One More Time' })).toBeVisible();
      const reloaded = reads();
      await advance(page, 30_000);
      expect(reads()).toBe(reloaded);
      const again = await openSettings(page);
      await expect(
        again.getByRole('group', { name: 'Poll Spotify for updates' }).getByRole('button', { name: 'Off' })
      ).toHaveAttribute('aria-pressed', 'true');

      await again.getByRole('group', { name: 'Poll Spotify for updates' }).getByRole('button', { name: 'On' }).click();
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

    test('Wi-Fi, Restart kiosk and Reboot Pi ask the kiosk service, the last two only on a second tap', async ({
      page
    }) => {
      const asked: string[] = [];
      await page.route('http://127.0.0.1:7341/**', route => {
        asked.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
        return route.fulfill({ status: 204 });
      });
      await page.goto('/');
      const dialog = await openSettings(page);

      await dialog.getByRole('button', { name: 'Wi-Fi network' }).click();
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

  test('the kiosk-only settings are not offered away from the kiosk', async ({ page }) => {
    await page.goto('/?kiosk=0');
    const dialog = await openSettings(page);
    await expect(dialog.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await expect(dialog.getByRole('group', { name: 'Poll Spotify for updates' })).toBeVisible();
    const kioskOnly = ['Wi-Fi network', 'Restart kiosk', 'Reboot Pi', 'Update now'];
    await Promise.all(kioskOnly.map(name => expect(dialog.getByRole('button', { name })).toHaveCount(0)));
    await expect(dialog.getByRole('group', { name: 'Screen sleep' })).toHaveCount(0);
  });
});
