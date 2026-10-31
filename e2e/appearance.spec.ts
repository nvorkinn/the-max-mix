import { expect, test } from '@playwright/test';
import { fakeSpotify } from './fakeSpotify.ts';

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

test.beforeEach(async ({ page }) => {
  await page.route('https://images.unsplash.com/**', route =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
  );
  await fakeSpotify(page);
});

for (const appearance of [
  { name: 'Studio', id: 'neon', surface: 'rgb(25, 28, 25)', ink: 'rgb(242, 243, 237)', scheme: 'dark' },
  { name: 'Paper', id: 'minimal', surface: 'rgb(250, 250, 246)', ink: 'rgb(35, 41, 31)', scheme: 'light' }
]) {
  test(`${appearance.name} appearance applies to dialogs, status and kiosk controls`, async ({ page }) => {
    await page.goto('/?kiosk=1');
    await page.getByRole('button', { name: 'Open settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings
      .getByRole('button', { name: appearance.id === 'minimal' ? /Paper Light/ : /Studio Signature/ })
      .click();
    await expect(page.locator('.tablet-container')).toHaveAttribute('data-theme', appearance.id);
    await expect(settings).toHaveCSS('background-color', appearance.surface);
    await expect(settings).toHaveCSS('color', appearance.ink);
    await expect(settings).toHaveCSS('color-scheme', appearance.scheme);
    await expect(settings.getByRole('button', { name: 'Wi-Fi network' })).toHaveCSS('color', appearance.ink);
    await expect(settings.getByRole('button', { name: 'Restart kiosk' })).toHaveCSS('color', appearance.ink);

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
    await expect(page.locator('.tablet-container')).toHaveAttribute('data-theme', appearance.id);
    await page.getByRole('button', { name: 'Choose a Spotify Connect device' }).click();
    const speakers = page.getByRole('dialog', { name: 'Choose a Spotify device' });
    await expect(speakers).toHaveCSS('background-color', appearance.surface);
    await expect(speakers).toHaveCSS('color', appearance.ink);
    await expect(speakers.getByRole('button', { name: /Test speaker/ })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');

    await page.keyboard.press('Control+Shift+D');
    const debug = page.getByRole('dialog', { name: 'Debug console' });
    await expect(debug).toHaveCSS('background-color', 'rgb(11, 13, 11)');
    await expect(debug).toHaveCSS('color-scheme', 'dark');
    await page.keyboard.press('Escape');
  });
}
