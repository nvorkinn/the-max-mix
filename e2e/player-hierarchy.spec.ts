import { expect, test } from '@playwright/test';
import { getClientId } from '../src/spotify/settings.ts';

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const LONG_TITLE = `${'An extended placeholder title with extra recording details '.repeat(8)}${'Unbroken'.repeat(24)}`;
const LONG_ARTIST = 'A placeholder artist with a second guest artist '.repeat(4);

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('https://images.unsplash.com/**', route =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
  );
});

for (const appearance of ['minimal']) {
  for (const viewport of [{ width: 1024, height: 600 }]) {
    test(`complete track metadata fits ${viewport.width}x${viewport.height} in ${appearance}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.route('https://accounts.spotify.com/api/token', route =>
        route.fulfill({ json: { access_token: 'not-a-real-access-token', expires_in: 3600 } })
      );
      const item = {
        id: 'test-track',
        name: LONG_TITLE,
        artists: [{ name: LONG_ARTIST }],
        duration_ms: 200_000,
        album: { images: [{ url: 'https://images.unsplash.com/test-art' }] }
      };
      await page.route('https://api.spotify.com/v1/me/player', route =>
        route.fulfill({
          json: {
            is_playing: true,
            progress_ms: 12_000,
            item,
            device: {
              id: 'test-speaker',
              name: 'Test kitchen speaker',
              is_active: true,
              is_restricted: false,
              supports_volume: true,
              volume_percent: 55
            }
          }
        })
      );
      await page.route('https://api.spotify.com/v1/me/player/queue', route =>
        route.fulfill({ json: { currently_playing: item, queue: [] } })
      );
      await page.addInitScript(
        ({ theme, clientId }) => {
          /* eslint-disable n/no-unsupported-features/node-builtins -- This init script runs in the browser, not Node. */
          localStorage.setItem('maxmix_theme', theme);
          localStorage.setItem('maxmix.playbackMode', 'remote');
          localStorage.setItem('maxmix.auth', JSON.stringify({ clientId, refreshToken: 'not-a-real-refresh-token' }));
          /* eslint-enable n/no-unsupported-features/node-builtins */
        },
        { theme: appearance, clientId: getClientId() }
      );
      await page.goto('/');
      const player = page.getByRole('region', { name: 'Now playing', exact: true });
      const metadata = player.getByRole('region', { name: 'Track information' });
      const title = metadata.getByRole('heading', { name: LONG_TITLE });
      await expect(title).toBeVisible();
      await expect(metadata).toContainText(LONG_ARTIST.trim());
      await expect(title).toHaveCSS('white-space', 'normal');
      expect(await title.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(
        await title.evaluate(
          element =>
            element.getBoundingClientRect().height > Number(getComputedStyle(element).lineHeight.replace('px', ''))
        )
      ).toBe(true);
      expect(
        await title.evaluate(element => Number(getComputedStyle(element).fontSize.replace('px', '')))
      ).toBeGreaterThan(
        await metadata.locator('p').evaluate(element => Number(getComputedStyle(element).fontSize.replace('px', '')))
      );
      await expect(player.getByText('Test kitchen speaker', { exact: true })).toBeVisible();
      await expect(player.getByRole('img', { name: `${LONG_TITLE} album artwork` })).toHaveCSS('object-fit', 'contain');
      await expect(player.getByRole('button', { name: /Celebrate/ })).toHaveCount(0);
      await expect(player.locator('canvas, .art-caption, .art-equalizer, .track-visualizer')).toHaveCount(0);
      expect(await page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);

      expect(await metadata.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
      await metadata.focus();
      await page.keyboard.press('End');
      await expect.poll(() => metadata.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      await expect(player.getByRole('button', { name: 'Pause' })).toBeInViewport();
      await expect(player.locator('.album-art')).toBeInViewport();
      const targets = await player
        .getByRole('button', { name: /^(Pause|Next track|Previous track)$/ })
        .evaluateAll(elements =>
          elements.map(element => {
            const { width, height } = element.getBoundingClientRect();
            return { width, height };
          })
        );
      expect(targets).toHaveLength(3);
      for (const target of targets) {
        expect(target.width).toBeGreaterThanOrEqual(44);
        expect(target.height).toBeGreaterThanOrEqual(44);
      }
    });
  }
}
