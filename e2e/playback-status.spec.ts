import { expect, test, type Page, type Locator } from '@playwright/test';
import { getClientId } from '../src/spotify/settings.ts';
import type { PlaybackState } from '../src/types.ts';

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const playback = {
  is_playing: true,
  progress_ms: 12_000,
  item: {
    id: 'test-track',
    name: 'A placeholder title with recording details '.repeat(8),
    duration_ms: 200_000,
    artists: [{ name: 'Test artist' }]
  },
  device: {
    id: 'test-device',
    name: 'Test speaker',
    is_active: true,
    is_restricted: false,
    supports_volume: true,
    volume_percent: 50
  }
} satisfies PlaybackState;

async function mockSpotify(page: Page, theme: string) {
  const api: {
    playback: PlaybackState | null;
    nextStatus: number;
    queueStatus: number;
    playbackWait?: Promise<void>;
    queueWait?: Promise<void>;
    commands: string[];
    playbackReads: number;
  } = { playback, nextStatus: 204, queueStatus: 200, commands: [], playbackReads: 0 };
  await page.route('https://accounts.spotify.com/api/token', route =>
    route.fulfill({ json: { access_token: 'not-a-real-access-token', expires_in: 3600 } })
  );
  await page.route('https://api.spotify.com/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    switch (`${route.request().method()} ${path}`) {
      case 'GET /v1/me/player': {
        api.playbackReads++;
        await api.playbackWait;
        await route.fulfill(api.playback ? { json: api.playback } : { status: 204 });
        break;
      }
      case 'GET /v1/me/player/queue': {
        await api.queueWait;
        await route.fulfill(
          api.queueStatus === 200
            ? { json: { currently_playing: api.playback?.item ?? null, queue: [] } }
            : { status: api.queueStatus, json: { error: { message: 'Test queue failure' } } }
        );
        break;
      }
      case 'GET /v1/me/player/devices': {
        await route.fulfill({ json: { devices: [playback.device] } });
        break;
      }
      case 'POST /v1/me/player/next': {
        api.commands.push(path);
        await route.fulfill(
          api.nextStatus === 204
            ? { status: 204 }
            : { status: api.nextStatus, json: { error: { message: 'Test playback rejection' } } }
        );
        break;
      }
      default: {
        throw new Error(`Unexpected Spotify request: ${route.request().method()} ${path}`);
      }
    }
  });
  await page.addInitScript(
    ({ themeName, clientId }) => {
      /* eslint-disable n/no-unsupported-features/node-builtins -- This init script runs in the browser, not Node. */
      localStorage.setItem('maxmix_theme', themeName);
      localStorage.setItem('maxmix.playbackMode', 'remote');
      localStorage.setItem('maxmix.auth', JSON.stringify({ clientId, refreshToken: 'not-a-real-refresh-token' }));
      /* eslint-enable n/no-unsupported-features/node-builtins */
    },
    { themeName: theme, clientId: getClientId() }
  );
  return api;
}

async function expectControlsFit(page: Page, player: Locator) {
  const targets = await player.locator('button:visible').evaluateAll(elements =>
    elements.map(element => {
      const { width, height } = element.getBoundingClientRect();
      return { width, height };
    })
  );
  expect(targets.length).toBeGreaterThan(0);
  for (const target of targets) {
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.route('https://images.unsplash.com/**', route =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
  );
});

for (const theme of ['neon', 'minimal']) {
  test(`signed-out playback is not a connected or empty session in ${theme}`, async ({ page }) => {
    await page.addInitScript(appearance => {
      /* eslint-disable-next-line n/no-unsupported-features/node-builtins -- This init script runs in the browser, not Node. */
      localStorage.setItem('maxmix_theme', appearance);
    }, theme);
    await page.goto('/');
    const player = page.getByRole('region', { name: 'Now playing', exact: true });
    await expect(player.getByRole('button', { name: 'Connect Spotify' })).toBeVisible();
    await expect(player.getByRole('slider', { name: 'Playback position' })).toHaveCount(0);
    await expect(player.getByRole('button', { name: 'Try demo' })).toBeVisible();
    await expect(page.locator('.session-status .status-dot')).toHaveClass(/status-dot-idle/);
    await expect(page.locator('.app-footer .status-dot')).toHaveClass(/status-dot-idle/);
    await expect(page.getByText('0 tracks', { exact: true })).toHaveCount(0);
    await expect(page.getByText('A little quiet in here.')).toHaveCount(0);
    await expectControlsFit(page, player);
    await player.getByRole('button', { name: 'Connection settings' }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  });

  test(`connecting and no-device states remain distinct in ${theme}`, async ({ page }) => {
    const api = await mockSpotify(page, theme);
    const { promise, resolve } = Promise.withResolvers<undefined>();
    api.playback = null;
    api.playbackWait = promise;
    await page.goto('/');
    const player = page.getByRole('region', { name: 'Now playing', exact: true });
    await expect(player.getByText('Connecting to Spotify...')).toBeVisible();
    await expect(player.getByRole('button', { name: 'Play', exact: true })).toBeDisabled();
    resolve(undefined);
    await expect(player.getByText('No active Spotify device')).toBeVisible();
    await expectControlsFit(page, player);
    await expect(player.getByRole('button', { name: 'Choose speaker', exact: true })).toBeInViewport();
    await player.getByRole('button', { name: 'Choose speaker', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Choose a Spotify device' })).toBeVisible();
    expect(api.commands).toEqual([]);
  });

  test(`restricted devices explain disabled controls in ${theme}`, async ({ page }) => {
    const api = await mockSpotify(page, theme);
    api.playback = { ...playback, device: { ...playback.device, is_restricted: true } };
    await page.goto('/');
    const player = page.getByRole('region', { name: 'Now playing', exact: true });
    await expect(player.getByText('Controls unavailable on this device')).toBeVisible();
    await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeDisabled();
    await expect(player.getByRole('button', { name: 'Choose speaker', exact: true })).toBeInViewport();
    await expectControlsFit(page, player);
    expect(api.commands).toEqual([]);
  });

  test(`offline controls recover without demo fallback in ${theme}`, async ({ page }) => {
    await mockSpotify(page, theme);
    await page.goto('/');
    const player = page.getByRole('region', { name: 'Now playing', exact: true });
    await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
    await page.context().setOffline(true);
    await expect(page.getByRole('alert')).toContainText('No internet connection');
    await expect(player.getByText('Playback controls are offline')).toBeVisible();
    await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeDisabled();
    await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeInViewport();
    await expectControlsFit(page, player);
    await page.context().setOffline(false);
    await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();
    await expect(page.locator('.app-footer')).not.toContainText('simulated playback');
  });

  test(`queue loading, failure and confirmed empty are distinct in ${theme}`, async ({ page }) => {
    const api = await mockSpotify(page, theme);
    const { promise, resolve } = Promise.withResolvers<undefined>();
    api.queueStatus = 500;
    api.queueWait = promise;
    await page.goto('/');
    const queue = page.getByRole('region', { name: 'Upcoming tracks' });
    await expect(queue.getByText('Loading queue...')).toBeVisible();
    await expect(queue.getByText('0 tracks', { exact: true })).toHaveCount(0);
    resolve(undefined);
    await expect(queue.getByText('Queue unavailable.')).toBeVisible();
    await expect(queue.getByText('A little quiet in here.')).toHaveCount(0);
    api.queueStatus = 200;
    await queue.getByRole('button', { name: 'Retry queue' }).click();
    await expect(queue.getByText('A little quiet in here.')).toBeVisible();
    await expect(queue.getByText('0 tracks', { exact: true })).toBeVisible();
  });
}

for (const { width, height, theme } of [
  { width: 1024, height: 600, theme: 'neon' },
  { width: 1024, height: 600, theme: 'minimal' }
]) {
  test(`playback recovery fits ${width}x${height} in ${theme} without repeating a skip`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const api = await mockSpotify(page, theme);
    api.nextStatus = 500;
    await page.goto('/');
    const player = page.getByRole('region', { name: 'Now playing', exact: true });
    await player.getByRole('button', { name: 'Next track' }).click();
    await expect(player.getByRole('alert')).toContainText('Playback problem');
    await expectControlsFit(page, player);
    await expect(player.getByRole('button', { name: 'Refresh playback' })).toBeInViewport();
    await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeInViewport();
    await player.getByRole('button', { name: 'Details', exact: true }).click();
    const debug = page.getByRole('dialog', { name: 'Debug console' });
    await expect(debug).toContainText('Spotify request failed (500).');
    await debug.getByRole('button', { name: 'Close debug console' }).click();
    const reads = api.playbackReads;
    await player.getByRole('button', { name: 'Refresh playback' }).click();
    await expect(player.getByRole('alert')).toHaveCount(0);
    expect(api.playbackReads).toBeGreaterThan(reads);
    expect(api.commands).toEqual(['/v1/me/player/next']);
    await expect(page.locator('.app-footer')).not.toContainText('simulated playback');
  });
}
