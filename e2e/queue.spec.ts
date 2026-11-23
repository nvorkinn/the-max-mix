import { expect, test, type Page } from '@playwright/test';
import { fakeSpotify, PIXEL } from './fake-spotify.ts';
import { openSpotifyTab } from './spotify-tab.ts';

test.beforeEach(async ({ page }) => {
  await page.route('https://images.unsplash.com/**', route =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
  );
  await fakeSpotify(page);
});

const nowPlaying = (page: Page) => page.getByRole('region', { name: 'Now playing' });
const upcoming = (page: Page) => page.getByRole('region', { name: 'Upcoming tracks' });

test.describe('Queue', { tag: '@queue' }, () => {
  test('reads the queue once after the initial playback response', async ({ page }) => {
    const playbackUrl = 'https://api.spotify.com/v1/me/player';
    const queueUrl = `${playbackUrl}/queue`;
    const playback = Promise.withResolvers<undefined>();
    await page.route(playbackUrl, async route => {
      await playback.promise;
      await route.fallback();
    });

    const events: string[] = [];
    page.on('request', request => {
      if (request.url() === queueUrl) events.push('queue request');
    });
    page.on('response', response => {
      if (response.url() === playbackUrl && !events.includes('playback response')) events.push('playback response');
    });

    try {
      await openSpotifyTab(page);
    } finally {
      playback.resolve(undefined);
    }

    await expect(upcoming(page)).toContainText('Starboy');
    expect(events).toEqual(['playback response', 'queue request']);
  });

  test('tapping a queued song plays it and drops the songs before it from the queue', async ({ page }) => {
    await openSpotifyTab(page);
    await upcoming(page).getByRole('button', { name: 'Play Music Sounds Better with You by Stardust' }).click();
    await expect(nowPlaying(page)).toContainText('Music Sounds Better with You');
    await expect(upcoming(page)).not.toContainText('Starboy');
    await expect(upcoming(page)).not.toContainText('Levitating');
    await expect(upcoming(page)).toContainText('Midnight City');
  });
});
