import { expect, test } from '@playwright/test';
import { fakeSpotify, PIXEL } from './fake-spotify.ts';

test.describe('Appearance of dialogs', { tag: ['@appearance', '@settings'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
    );
    await fakeSpotify(page);
  });

  const PAPER = { surface: 'rgb(250, 250, 246)', ink: 'rgb(35, 41, 31)', scheme: 'light' };

  test('Paper appearance applies to dialogs, status and kiosk controls', async ({ page }) => {
    await page.goto('/?kiosk=1');
    await page.getByRole('button', { name: 'Open settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await expect(settings).toHaveCSS('background-color', PAPER.surface);
    await expect(settings).toHaveCSS('color', PAPER.ink);
    await expect(settings).toHaveCSS('color-scheme', PAPER.scheme);
    await expect(settings.getByRole('button', { name: 'Wi-Fi network' })).toHaveCSS('color', PAPER.ink);
    await expect(settings.getByRole('button', { name: 'Restart kiosk' })).toHaveCSS('color', PAPER.ink);

    const contrast = await settings.evaluate(panel => {
      const view = panel.ownerDocument.defaultView;
      if (!view) throw new Error('Missing browser window');
      const canvas = panel.ownerDocument.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Missing canvas context');
      const luminance = () => {
        const linear = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(channel => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return (linear[0] ?? 0) * 0.2126 + (linear[1] ?? 0) * 0.7152 + (linear[2] ?? 0) * 0.0722;
      };
      const measure = (element: Element) => {
        const ancestors: Element[] = [];
        for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
          ancestors.unshift(ancestor);
        }
        context.fillStyle = '#fff';
        context.fillRect(0, 0, 1, 1);
        for (const ancestor of ancestors) {
          context.fillStyle = view.getComputedStyle(ancestor).backgroundColor;
          context.fillRect(0, 0, 1, 1);
        }
        const background = luminance();
        context.fillStyle = view.getComputedStyle(element).color;
        context.fillRect(0, 0, 1, 1);
        const foreground = luminance();
        return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
      };
      const values = [...panel.querySelectorAll('.text-muted, .text-accent')].map(element => measure(element));
      for (const status of ['success', 'warning', 'danger']) {
        const badge = panel.ownerDocument.createElement('span');
        badge.className = `modal-status status-${status}`;
        panel.append(badge);
        values.push(measure(badge));
        badge.remove();
      }
      return values;
    });
    for (const ratio of contrast) expect(ratio).toBeGreaterThanOrEqual(4.5);

    await settings.getByRole('button', { name: 'Restart kiosk' }).click();
    await expect(settings.getByRole('button', { name: 'Tap again to restart' })).toHaveClass(/modal-confirm-armed/);
    await page.keyboard.press('Escape');
    await page.reload();
    await page.getByRole('button', { name: /^Speakers:/ }).click();
    const speakers = page.getByRole('dialog', { name: 'Speakers' });
    await expect(speakers).toHaveCSS('background-color', PAPER.surface);
    await expect(speakers).toHaveCSS('color', PAPER.ink);
    await expect(speakers.getByRole('button', { name: /Test speaker/ })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');

    await page.keyboard.press('Control+Shift+D');
    const debug = page.getByRole('dialog', { name: 'Debug console' });
    await expect(debug).toHaveCSS('background-color', 'rgb(11, 13, 11)');
    await expect(debug).toHaveCSS('color-scheme', 'dark');
    await page.keyboard.press('Escape');
  });

  test('Night recolours the app, greys out the Day colour, and Day brings that colour back', async ({ page }) => {
    await page.goto('/?kiosk=1');
    const room = page.locator('.tablet-container');
    await expect(room).toHaveAttribute('data-theme', 'day');
    let settings = page.getByRole('dialog', { name: 'Settings' });
    await page.getByRole('button', { name: 'Open settings' }).click();
    await settings.getByRole('button', { name: 'Navy' }).click();
    const theme = settings.getByRole('group', { name: 'Theme' });
    await expect(theme.getByRole('button', { name: 'Auto' })).toHaveCount(0);
    await theme.getByRole('button', { name: 'Night' }).click();

    await expect(room).toHaveAttribute('data-theme', 'night');
    await expect(room).toHaveCSS('background-color', 'rgb(9, 14, 31)');
    await expect(settings).toHaveCSS('background-color', 'rgb(16, 26, 51)');
    await expect(settings).toHaveCSS('color', 'rgb(245, 246, 255)');
    await expect(settings).toHaveCSS('color-scheme', 'dark');
    await expect(settings.getByRole('button', { name: 'Navy' })).toBeDisabled();
    await expect(settings.getByRole('button', { name: 'Navy' })).toHaveAttribute('aria-pressed', 'true');

    await page.reload();
    await expect(room).toHaveAttribute('data-theme', 'night');
    await page.getByRole('button', { name: 'Open settings' }).click();
    settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Day' }).click();
    await expect(room).toHaveAttribute('data-theme', 'day');
    await expect(room).toHaveAttribute('data-colour', 'navy');
    await expect(settings).toHaveCSS('background-color', PAPER.surface);
    await expect(settings.getByRole('button', { name: 'Navy' })).toBeEnabled();
  });

  test('Auto, offered when the kiosk knows where it is, follows the sun', async ({ page }) => {
    // An hour after sunset in London on midsummer's day.
    await page.clock.setFixedTime(new Date('2026-06-21T21:20:00Z'));
    await page.goto('/?kiosk=1&lat=51.51&lon=-0.13');
    const room = page.locator('.tablet-container');
    await page.getByRole('button', { name: 'Open settings' }).click();
    const theme = page.getByRole('dialog', { name: 'Settings' }).getByRole('group', { name: 'Theme' });
    await theme.getByRole('button', { name: 'Auto' }).click();
    await expect(theme.getByRole('button', { name: 'Auto' })).toHaveAttribute('aria-pressed', 'true');
    await expect(room).toHaveAttribute('data-theme', 'night');

    await page.clock.setFixedTime(new Date('2026-06-22T12:00:00Z'));
    await page.reload();
    await expect(room).toHaveAttribute('data-theme', 'day');
  });
});
