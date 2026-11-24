import { expect, test } from '@playwright/test';
import { getClientId } from '../src/spotify/settings.ts';
import { fakeCountdownServer, SPOTIFY_REDIRECT } from './fake-countdown.ts';
import { PIXEL } from './fake-spotify.ts';
import { openSpotifyTab } from './spotify-tab.ts';

test.describe('Setup and signing in', { tag: '@setup' }, () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
    );
  });

  test('tablet setup fits 1280x800 and sends no Spotify commands', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'requestMediaKeySystemAccess', { value: undefined, configurable: true });
    });
    const commands: string[] = [];
    await page.route('https://api.spotify.com/**', route => {
      commands.push(route.request().method());
      return route.fulfill({ status: 503 });
    });
    await openSpotifyTab(page);
    const setup = page.getByRole('region', { name: 'Now playing' });
    await expect(setup.getByRole('button', { name: 'Connect Spotify' })).toBeInViewport();
    await expect(setup.getByRole('slider')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Upcoming tracks' })).toHaveCount(0);
    await expect(setup.getByRole('button')).toHaveText(['Connect Spotify']);
    expect(commands).toEqual([]);
    expect(await page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  });

  test('Connect shows a code for a phone, and the kiosk signs in with its own verifier once the phone is back', async ({
    page
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const { spotifySignIns } = await fakeCountdownServer(page, null);
    const exchanges: URLSearchParams[] = [];
    await page.route('https://accounts.spotify.com/api/token', route => {
      exchanges.push(new URLSearchParams(route.request().postData() ?? ''));
      return route.fulfill({ json: { access_token: 'a', refresh_token: 'r', expires_in: 3600 } });
    });
    await page.route('https://api.spotify.com/v1/me', route =>
      route.fulfill({ json: { id: 'max', display_name: 'Max', images: [] } })
    );
    await openSpotifyTab(page);
    await page.getByRole('button', { name: 'Connect Spotify' }).click();

    // Nothing of Spotify's own sign-in on the kiosk: a code for the phone, of the settings site's sign-in page.
    const dialog = page.getByRole('dialog', { name: 'Sign in to Spotify' });
    await expect(dialog.getByRole('img', { name: 'Sign in to Spotify' })).toBeVisible();
    expect(page.url()).not.toContain('accounts.spotify.com');
    await expect.poll(() => spotifySignIns.started.length).toBe(1);
    const [asked] = spotifySignIns.started;
    expect(asked).toMatchObject({ client_id: getClientId(), code_challenge: expect.stringMatching(/^[\w-]{43}$/) });
    expect(asked).not.toHaveProperty('code_verifier');

    spotifySignIns.phoneComesBack({ code: 'the-code' });
    await expect.poll(() => page.evaluate(() => localStorage.getItem('maxmix.people'))).toContain('"max"');
    const [exchange] = exchanges;
    expect(exchange?.get('code')).toBe('the-code');
    expect(exchange?.get('redirect_uri')).toBe(SPOTIFY_REDIRECT);
    // The verifier the kiosk kept is the one its challenge was made from.
    const verifier = exchange?.get('code_verifier') ?? '';
    const challenge = await page.evaluate(async text => {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return btoa(String.fromCodePoint(...new Uint8Array(digest)))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '');
    }, verifier);
    expect(challenge).toBe(asked?.['code_challenge']);
  });

  test('a phone that declined shows why, with a new code to try again', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const { spotifySignIns } = await fakeCountdownServer(page, null);
    await openSpotifyTab(page);
    await page.getByRole('button', { name: 'Connect Spotify' }).click();
    const dialog = page.getByRole('dialog', { name: 'Sign in to Spotify' });
    await expect(dialog.getByRole('img', { name: 'Sign in to Spotify' })).toBeVisible();

    spotifySignIns.phoneComesBack({ error: 'access_denied' });
    await expect(dialog.getByRole('alert')).toHaveText('Spotify sign-in was declined.');
    await expect.poll(() => spotifySignIns.started.length).toBe(2);
    await expect(dialog.getByRole('img', { name: 'Sign in to Spotify' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Back' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Connect Spotify' })).toBeEnabled();
  });
});
