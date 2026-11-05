import { expect, test, type Page } from '@playwright/test';
import { fakeSpotify } from './fake-spotify.ts';

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

// What the fake Spotify account was sent and has saved, for the page of the test that is running.
const accounts = new WeakMap<Page, Awaited<ReturnType<typeof fakeSpotify>>>();
const accountOf = (page: Page) => {
  const account = accounts.get(page);
  if (!account) throw new Error('This page has no fake Spotify account');
  return account;
};
// Shuffle and repeat show the tap at once, well before the next poll (every 4 s) could have reported it.
const AT_ONCE = { timeout: 1500 };

test.beforeEach(async ({ page }) => {
  await page.route('https://images.unsplash.com/**', route =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
  );
  accounts.set(page, await fakeSpotify(page));
});

const nowPlaying = (page: Page) => page.getByRole('region', { name: 'Now playing' });
const upcoming = (page: Page) => page.getByRole('region', { name: 'Upcoming tracks' });

test.describe('Player', { tag: '@player' }, () => {
  test('shows the playing track and what is queued next', { tag: '@queue' }, async ({ page }) => {
    await page.goto('/');
    await expect(nowPlaying(page)).toContainText('One More Time');
    await expect(nowPlaying(page)).toContainText('Daft Punk');
    await expect(upcoming(page)).toContainText('Starboy');
    await expect(upcoming(page)).toContainText('Levitating');
  });

  test('Pause and Play toggle playback', async ({ page }) => {
    await page.goto('/');
    await nowPlaying(page).getByRole('button', { name: 'Pause' }).click();
    await expect(nowPlaying(page).getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await expect(nowPlaying(page).getByRole('button', { name: 'Pause' })).toBeHidden();

    await nowPlaying(page).getByRole('button', { name: 'Play', exact: true }).click();
    await expect(nowPlaying(page).getByRole('button', { name: 'Pause' })).toBeVisible();
  });

  test('the 15 second buttons rewind and fast-forward the song', async ({ page }) => {
    await page.goto('/');
    const position = nowPlaying(page).getByRole('slider', { name: 'Playback position' });
    // The fake starts 45 s in and the clock keeps running, so the position is a second or two past the round number.
    await expect(position).toHaveAttribute('aria-valuetext', /^0:4[5-9] of /);
    await nowPlaying(page).getByRole('button', { name: 'Forward 15 seconds' }).click();
    await expect(position).toHaveAttribute('aria-valuetext', /^1:0\d of /);
    await nowPlaying(page).getByRole('button', { name: 'Back 15 seconds' }).click();
    await expect(position).toHaveAttribute('aria-valuetext', /^0:4\d of /);
  });

  test('Next and Previous change the track', { tag: '@queue' }, async ({ page }) => {
    await page.goto('/');
    await nowPlaying(page).getByRole('button', { name: 'Next track' }).click();
    await expect(nowPlaying(page)).toContainText('Starboy');
    await expect(upcoming(page)).not.toContainText('Starboy');

    await nowPlaying(page).getByRole('button', { name: 'Previous track' }).click();
    await expect(nowPlaying(page)).toContainText('One More Time');
    await expect(upcoming(page)).toContainText('Starboy');
  });

  test('Shuffle turns on and off and shows which it is', async ({ page }) => {
    await page.goto('/');
    const shuffle = nowPlaying(page).getByRole('button', { name: 'Shuffle' });
    await expect(shuffle).toHaveAttribute('aria-pressed', 'false');
    await shuffle.click();
    await expect(shuffle).toHaveAttribute('aria-pressed', 'true', AT_ONCE);
    expect(accountOf(page).commands).toContain('PUT /v1/me/player/shuffle?state=true');
    await shuffle.click();
    await expect(shuffle).toHaveAttribute('aria-pressed', 'false', AT_ONCE);
    expect(accountOf(page).commands).toContain('PUT /v1/me/player/shuffle?state=false');
  });

  test('Repeat goes from off to all to one and back, and says which it is', async ({ page }) => {
    await page.goto('/');
    const repeat = (name: string) => nowPlaying(page).getByRole('button', { name });
    await expect(repeat('Repeat off')).toBeVisible();
    await repeat('Repeat off').click();
    await expect(repeat('Repeat all')).toBeVisible(AT_ONCE);
    await repeat('Repeat all').click();
    await expect(repeat('Repeat one')).toBeVisible(AT_ONCE);
    await repeat('Repeat one').click();
    await expect(repeat('Repeat off')).toBeVisible(AT_ONCE);
    expect(accountOf(page).commands.filter(command => command.includes('/repeat'))).toEqual([
      'PUT /v1/me/player/repeat?state=context',
      'PUT /v1/me/player/repeat?state=track',
      'PUT /v1/me/player/repeat?state=off'
    ]);
  });

  test('the heart saves the playing song to Liked Songs, takes it back, and is remembered for each song', async ({
    page
  }) => {
    await page.goto('/');
    const heart = page.getByRole('button', { name: 'Save to Liked Songs' });
    // The heart is for the song that plays, so it waits until Spotify has said whether it is saved.
    await expect(heart).toBeEnabled();
    await expect(heart).toHaveAttribute('aria-pressed', 'false');

    await heart.click();
    await expect(heart).toHaveAttribute('aria-pressed', 'true');
    expect(accountOf(page).saved).toEqual(new Set(['spotify:track:track-1']));
    expect(accountOf(page).commands).toContain(
      `PUT /v1/me/library?uris=${encodeURIComponent('spotify:track:track-1')}`
    );

    // Another song is not saved; going back to the first still is.
    await nowPlaying(page).getByRole('button', { name: 'Next track' }).click();
    await expect(nowPlaying(page)).toContainText('Starboy');
    await expect(heart).toBeEnabled();
    await expect(heart).toHaveAttribute('aria-pressed', 'false');
    await nowPlaying(page).getByRole('button', { name: 'Previous track' }).click();
    await expect(nowPlaying(page)).toContainText('One More Time');
    await expect(heart).toHaveAttribute('aria-pressed', 'true');

    await heart.click();
    await expect(heart).toHaveAttribute('aria-pressed', 'false');
    expect(accountOf(page).saved.size).toBe(0);
    expect(accountOf(page).commands).toContain(
      `DELETE /v1/me/library?uris=${encodeURIComponent('spotify:track:track-1')}`
    );
  });

  test('the volume slider sets the speaker volume, which is still there after a reload', async ({ page }) => {
    await page.goto('/');
    const volume = nowPlaying(page).getByRole('slider', { name: 'Volume' });
    await expect(volume).toHaveValue('80');
    await volume.fill('35');
    await expect(volume).toHaveValue('35');
    await expect.poll(() => accountOf(page).commands).toContain('PUT /v1/me/player/volume?volume_percent=35');

    await page.reload();
    await expect(nowPlaying(page).getByRole('slider', { name: 'Volume' })).toHaveValue('35');
  });

  test('failed images become local artwork rather than retrying URLs', { tag: '@queue' }, async ({ page }) => {
    await page.route('https://images.unsplash.com/**', route => route.abort());
    await page.goto('/');
    await expect(page.locator('.album-cover.image-placeholder')).toBeVisible();
    await expect(page.locator('.queue-art.image-placeholder')).toHaveCount(4);

    await page.getByRole('button', { name: 'Open settings' }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.album-cover.image-placeholder')).toBeVisible();

    await page.unroute('https://images.unsplash.com/**');
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
    );
    await page.getByRole('button', { name: 'Next track' }).click();
    await expect(page.getByRole('heading', { name: 'Starboy' }).first()).toBeVisible();
    await expect(page.locator('img.album-cover')).toBeVisible();
  });
});
