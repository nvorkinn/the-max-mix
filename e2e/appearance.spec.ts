import { expect, test } from '@playwright/test';
import { fakeSpotify, PIXEL } from './fake-spotify.ts';
import { showSection } from './settings.ts';
import { openSpotifyTab, showSpotifyTab } from './spotify-tab.ts';

test.describe('Appearance of dialogs', { tag: ['@appearance', '@settings'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
    );
    await fakeSpotify(page);
  });

  // The Settings tab lies on the Dashboard's photo, its cards Night's navy whatever the skin; the Spotify tab's words
  // are the photo's warm white.
  const NAVY = { surface: 'rgb(16, 26, 51)', ink: 'rgb(245, 246, 255)', scheme: 'dark' };
  const PHOTO_INK = 'rgb(247, 244, 236)';

  test('By day the photo tabs keep their dark look for settings, status and kiosk controls', async ({ page }) => {
    await openSpotifyTab(page, '/?kiosk=1');
    await page.getByRole('tab', { name: 'Settings' }).click();
    const settings = page.getByRole('tabpanel', { name: 'Settings' });
    await expect(page.locator('.tablet-container')).toHaveAttribute('data-theme', 'day');
    await expect(settings.locator('.settings-nav-item:not([aria-current])').first()).toHaveCSS(
      'background-color',
      NAVY.surface
    );
    await expect(settings.locator('.settings-panel')).toHaveCSS('color', NAVY.ink);
    await expect(settings.locator('.settings-panel')).toHaveCSS('color-scheme', NAVY.scheme);
    await showSection(settings, 'Wi-Fi');
    await expect(settings.getByRole('button', { name: 'Choose network' })).toHaveCSS('color', NAVY.ink);
    await showSection(settings, 'About');
    await expect(settings.getByRole('button', { name: 'Restart kiosk' })).toHaveCSS('color', NAVY.ink);

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
        // From the tab's own panel down: the page under it is hidden behind the photo.
        for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
          ancestors.unshift(ancestor);
          if (ancestor === panel) break;
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
    await showSpotifyTab(page);
    await page.getByRole('button', { name: /^Speakers:/ }).click();
    const speakers = page.getByRole('region', { name: 'Speakers' });
    await expect(speakers).toHaveCSS('color', PHOTO_INK);
    await expect(speakers.getByRole('checkbox', { name: 'Test speaker' })).toBeChecked();

    await page.keyboard.press('Control+Shift+D');
    const debug = page.getByRole('dialog', { name: 'Debug console' });
    await expect(debug).toHaveCSS('background-color', 'rgb(11, 13, 11)');
    await expect(debug).toHaveCSS('color-scheme', 'dark');
    await page.keyboard.press('Escape');
  });

  test('Night recolours the app in a night shade of the colour, and Day brings the colour back', async ({ page }) => {
    await openSpotifyTab(page, '/?kiosk=1');
    const room = page.locator('.tablet-container');
    await expect(room).toHaveAttribute('data-theme', 'day');
    let settings = page.getByRole('tabpanel', { name: 'Settings' });
    await page.getByRole('tab', { name: 'Settings' }).click();
    await showSection(settings, 'Appearance');
    await settings.getByRole('button', { name: 'Navy' }).click();
    const theme = settings.getByRole('group', { name: 'Theme' });
    await expect(theme.getByRole('button', { name: 'Auto' })).toHaveCount(0);
    await theme.getByRole('button', { name: 'Night' }).click();

    await expect(room).toHaveAttribute('data-theme', 'night');
    await expect(room).toHaveCSS('background-color', 'rgb(9, 14, 31)');
    await expect(settings.locator('.settings-nav-item:not([aria-current])').first()).toHaveCSS(
      'background-color',
      NAVY.surface
    );
    await expect(settings.locator('.settings-panel')).toHaveCSS('color', NAVY.ink);
    await expect(settings.locator('.settings-panel')).toHaveCSS('color-scheme', NAVY.scheme);
    await expect(settings.getByRole('button', { name: 'Navy' })).toBeEnabled();
    // Navy's night shade, bright enough on the dark.
    await expect(room).toHaveCSS('--accent', '#5b8def');
    await expect(settings.getByRole('button', { name: 'Navy' })).toHaveAttribute('aria-pressed', 'true');

    await page.reload();
    await expect(room).toHaveAttribute('data-theme', 'night');
    await page.getByRole('tab', { name: 'Settings' }).click();
    settings = page.getByRole('tabpanel', { name: 'Settings' });
    await showSection(settings, 'Appearance');
    await settings.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Day' }).click();
    await expect(room).toHaveAttribute('data-theme', 'day');
    await expect(room).toHaveAttribute('data-colour', 'navy');
    // Day's paper page and its colour come back; the Settings tab's cards stay navy on the photo.
    await expect(room).toHaveCSS('background-color', 'rgb(241, 241, 233)');
    await expect(room).toHaveCSS('--accent', '#1f3a5f');
    await expect(settings.locator('.settings-nav-item:not([aria-current])').first()).toHaveCSS(
      'background-color',
      NAVY.surface
    );
    await expect(settings.getByRole('button', { name: 'Navy' })).toBeEnabled();
  });

  test('Dynamic turns on over the chosen colour, and stays on at Night', async ({ page }) => {
    await openSpotifyTab(page, '/?kiosk=1');
    const room = page.locator('.tablet-container');
    const settings = page.getByRole('tabpanel', { name: 'Settings' });
    await page.getByRole('tab', { name: 'Settings' }).click();
    await showSection(settings, 'Appearance');
    await settings.getByRole('button', { name: 'Teal' }).click();
    const dynamic = settings.getByRole('group', { name: 'Dynamic' });
    await expect(dynamic.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');
    await expect(room).not.toHaveAttribute('data-dynamic');

    await dynamic.getByRole('button', { name: 'On' }).click();
    await expect(room).toHaveAttribute('data-dynamic', '');
    await expect(room).toHaveAttribute('data-colour', 'teal');
    await expect(settings.getByRole('button', { name: 'Teal' })).toHaveAttribute('aria-pressed', 'true');

    await page.reload();
    await expect(room).toHaveAttribute('data-dynamic', '');
    await page.getByRole('tab', { name: 'Settings' }).click();
    await showSection(settings, 'Appearance');
    await settings.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Night' }).click();
    await expect(room).toHaveAttribute('data-theme', 'night');
    await expect(room).toHaveAttribute('data-dynamic', '');
    await expect(settings.getByRole('group', { name: 'Dynamic' }).getByRole('button', { name: 'Off' })).toBeEnabled();
  });

  test('Auto, offered when the kiosk knows where it is, follows the sun', async ({ page }) => {
    // An hour after sunset in London on midsummer's day.
    await page.clock.setFixedTime(new Date('2026-06-21T21:20:00Z'));
    await openSpotifyTab(page, '/?kiosk=1&lat=51.51&lon=-0.13');
    const room = page.locator('.tablet-container');
    await page.getByRole('tab', { name: 'Settings' }).click();
    await showSection(page.getByRole('tabpanel', { name: 'Settings' }), 'Appearance');
    const theme = page.getByRole('tabpanel', { name: 'Settings' }).getByRole('group', { name: 'Theme' });
    await theme.getByRole('button', { name: 'Auto' }).click();
    await expect(theme.getByRole('button', { name: 'Auto' })).toHaveAttribute('aria-pressed', 'true');
    await expect(room).toHaveAttribute('data-theme', 'night');

    await page.clock.setFixedTime(new Date('2026-06-22T12:00:00Z'));
    await page.reload();
    await expect(room).toHaveAttribute('data-theme', 'day');
  });
});
