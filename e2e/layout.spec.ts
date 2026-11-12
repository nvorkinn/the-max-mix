import { expect, test, type Locator, type Page } from '@playwright/test';
import { getClientId } from '../src/spotify/settings.ts';
import { fakeSpotify, PIXEL } from './fake-spotify.ts';

const LONG_TITLE = `${'An extended placeholder title with extra recording details '.repeat(8)}${'Unbroken'.repeat(24)}`;
const LONG_ARTIST = 'A placeholder artist with a second guest artist '.repeat(4);

async function expectTouchTargets(scope: Locator) {
  const targets = await scope.locator('button:visible, input[type="range"]:visible, a:visible').evaluateAll(elements =>
    elements.map(element => {
      const rect = element.getBoundingClientRect();
      return {
        label: element.getAttribute('aria-label') || element.textContent,
        width: rect.width,
        height: rect.height
      };
    })
  );
  expect(targets.length).toBeGreaterThan(0);
  for (const target of targets) {
    expect(target.width, `${target.label}: width`).toBeGreaterThanOrEqual(44);
    expect(target.height, `${target.label}: height`).toBeGreaterThanOrEqual(44);
  }
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(
    await page
      .getByRole('dialog')
      .evaluateAll(dialogs => dialogs.every(dialog => dialog.scrollWidth <= dialog.clientWidth))
  ).toBe(true);
}

// What fits and stays reachable on the kiosk's 1024x600 touch screen.
test.describe('Layout', { tag: '@layout' }, () => {
  test.describe('Touch targets and dialogs fit the screen', () => {
    test.beforeEach(async ({ page }) => {
      await page.route('https://images.unsplash.com/**', route =>
        route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
      );
      await fakeSpotify(page);
    });

    test('touch targets and dialogs fit 1024x600', async ({ page }) => {
      await page.setViewportSize({ width: 1024, height: 600 });
      await page.goto('/?kiosk=1');
      await expect(page.getByRole('heading', { name: 'One More Time' })).toBeVisible();
      await expectTouchTargets(page.locator('body'));
      await expectNoHorizontalOverflow(page);

      const transport = page.getByRole('button', { name: 'Pause', exact: true });
      await expect(transport).toBeInViewport();

      await page.getByRole('button', { name: 'Open settings' }).click();
      const settings = page.getByRole('dialog', { name: 'Settings' });
      await expect(settings).toBeVisible();
      await expectTouchTargets(settings);
      await expectNoHorizontalOverflow(page);
      await page.keyboard.press('Escape');
      await expect(settings).toBeHidden();

      await page.getByRole('button', { name: /^Speakers:/ }).click();
      const speakers = page.getByRole('region', { name: 'Speakers' });
      await expect(speakers.getByRole('checkbox', { name: 'Test speaker' })).toBeVisible();
      await expectTouchTargets(speakers);
      await expectNoHorizontalOverflow(page);
      await page.getByRole('navigation', { name: 'Beside the artwork' }).getByRole('button', { name: 'Queue' }).click();
      await expect(speakers).toBeHidden();
    });
  });

  test.describe('Player layout', () => {
    test('artwork is square and the control bar stays on screen at 1024x600', async ({ page }) => {
      await page.setViewportSize({ width: 1024, height: 600 });
      await page.route('https://images.unsplash.com/**', route =>
        route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
      );
      await fakeSpotify(page);
      await page.goto('/');
      const art = page.locator('.album-art');
      await expect(art).toBeVisible();
      const box = await art.boundingBox();
      expect(box).not.toBeNull();
      expect(Math.abs((box?.width ?? 0) - (box?.height ?? 1))).toBeLessThanOrEqual(2);
      // The seek and volume sliders and the transport buttons all sit inside the viewport, under the artwork.
      const controls = [
        page.getByRole('slider', { name: 'Playback position' }),
        page.getByRole('slider', { name: 'Volume' }),
        page.getByRole('button', { name: 'Pause' })
      ];
      await Promise.all(controls.map(control => expect(control).toBeInViewport({ ratio: 1 })));
      const controlBoxes = await Promise.all(controls.map(control => control.boundingBox()));
      for (const controlBox of controlBoxes) {
        expect(controlBox?.y ?? 0).toBeGreaterThan((box?.y ?? 0) + (box?.height ?? 0));
      }
      // Queue, Lyrics and Speakers stand down the right-hand edge beside the panel, as tall together as the artwork.
      const nav = page.getByRole('navigation', { name: 'Beside the artwork' });
      const navButtons = await Promise.all(
        ['Queue', 'Lyrics', 'Speakers'].map(name => nav.getByRole('button', { name, exact: true }).boundingBox())
      );
      const panel = await page.locator('.side-panel').boundingBox();
      for (const navButton of navButtons) {
        expect(navButton?.width ?? 0).toBeGreaterThanOrEqual(88);
        expect(navButton?.height ?? 0).toBeGreaterThanOrEqual(100);
        expect(navButton?.x ?? 0).toBeGreaterThan((panel?.x ?? 0) + (panel?.width ?? 0));
        expect((navButton?.x ?? 0) + (navButton?.width ?? 0)).toBeLessThanOrEqual(1024);
      }
      expect(Math.abs((navButtons[0]?.y ?? 0) - (box?.y ?? 1))).toBeLessThanOrEqual(1);
      expect(
        Math.abs((navButtons[2]?.y ?? 0) + (navButtons[2]?.height ?? 0) - (box?.y ?? 0) - (box?.height ?? 1))
      ).toBeLessThanOrEqual(1);
      expect(await page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    });
  });

  test.describe('Long track names', () => {
    test.beforeEach(async ({ page }) => {
      await page.route('https://images.unsplash.com/**', route =>
        route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
      );
    });

    test('complete track metadata fits 1024x600', async ({ page }) => {
      await page.setViewportSize({ width: 1024, height: 600 });
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
      await page.addInitScript(clientId => {
        localStorage.setItem('maxmix.playbackMode', 'remote');
        localStorage.setItem('maxmix.auth', JSON.stringify({ clientId, refreshToken: 'not-a-real-refresh-token' }));
      }, getClientId());
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
  });

  test.describe('Fonts', () => {
    // The kiosk can boot without DNS, so the app font must come from the app's own origin. Every other host is
    // blocked here, and the test records any attempt to reach one.
    test('Plus Jakarta Sans loads from the app with external requests blocked', async ({ page }) => {
      const origin = new URL(test.info().project.use.baseURL ?? 'http://127.0.0.1').origin;
      const fontRequests: string[] = [];
      page.on('request', request => {
        if (request.resourceType() === 'font') fontRequests.push(request.url());
      });
      await page.route(
        url => url.origin !== origin,
        route =>
          // Track artwork is remote; answer it locally so the page renders as usual, and abort everything else.
          route.request().resourceType() === 'image'
            ? route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
            : route.abort()
      );
      // Registered after the block above, so these answer Spotify's hosts first.
      await fakeSpotify(page);

      await page.setViewportSize({ width: 1024, height: 600 });
      await page.goto('/?kiosk=1');
      await expect(page.getByRole('heading', { name: 'One More Time' })).toBeVisible();

      // document.fonts.check() also passes when no @font-face matches, so look at the bundled faces' own status.
      const loaded = await page.locator('html').evaluate(async html => {
        const { fonts } = html.ownerDocument;
        await fonts.ready;
        return [...fonts]
          .filter(face => face.family.replaceAll('"', '') === 'Plus Jakarta Sans' && face.status === 'loaded')
          .map(face => face.weight);
      });
      expect(loaded.length).toBeGreaterThan(0);
      expect(await page.locator('body').evaluate(body => getComputedStyle(body).fontFamily)).toMatch(
        /^"Plus Jakarta Sans"/
      );
      expect(fontRequests.length).toBeGreaterThan(0);
      for (const url of fontRequests) expect(new URL(url).origin).toBe(origin);
      expect(await page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    });
  });
});
