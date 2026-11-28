// cspell:ignore Dagsnytt dagsnytt atten Abels tårn
import { expect, test, type Page } from '@playwright/test';
import { DASHBOARD_NOW } from './dashboard.ts';
import {
  dashboardConfig,
  fakeCountdownServer,
  fakeFeed,
  fakePodcasts,
  podcastsExample,
  silentWav
} from './fake-countdown.ts';
import { fakeKioskOutputs } from './fake-kiosk.ts';
import { fakeSpotify, PIXEL } from './fake-spotify.ts';

/** countdown-api's example shows, with episodes a minute long, so the fake audio can be as long as they are. */
function minuteLongShows() {
  const podcasts = podcastsExample();
  for (const show of podcasts.shows) {
    for (const episode of show.episodes) {
      episode.duration_s = 60;
      if (episode.progress && !episode.progress.finished) episode.progress.position_s = 20;
    }
  }
  return podcasts;
}

/** An owned kiosk through its setup, with countdown-server's NRK podcasts faked, open on the Dashboard. */
async function openKiosk(page: Page, options: Parameters<typeof fakePodcasts>[1] = {}) {
  await fakeSpotify(page);
  await fakeCountdownServer(page, dashboardConfig(), { hasAccount: true });
  await fakeFeed(page, DASHBOARD_NOW);
  await fakeKioskOutputs(page, []);
  const reports = await fakePodcasts(page, options);
  await page.route('https://images.unsplash.com/**', route =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
  );
  await page.route('https://gfx.nrk.no/**', route =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
  );
  await page.clock.setFixedTime(DASHBOARD_NOW);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?kiosk=1');
  return reports;
}

test.describe('Podcasts', { tag: '@podcasts' }, () => {
  test('a kiosk whose owner has NRK linked has a Podcasts tab after Spotify, listing the shows', async ({ page }) => {
    await openKiosk(page);
    await expect(page.getByRole('tab', { name: 'Podcasts' })).toBeVisible();
    await expect(page.getByRole('tab')).toHaveText(['Spotify', 'Podcasts', 'Dashboard', 'Settings']);
    await page.getByRole('tab', { name: 'Podcasts' }).click();
    const panel = page.getByRole('tabpanel', { name: 'Podcasts' });
    // The part-listened episode comes first, then the favourite and the pinned show.
    const continuing = panel.getByRole('region', { name: 'Continue listening' });
    await expect(continuing.getByRole('button')).toHaveText([/Dagsnytt 18 – 27\. november/]);
    await expect(panel.getByRole('region', { name: 'Shows' }).getByRole('button')).toHaveText([
      'Dagsnytt 18',
      'Abels tårn'
    ]);
  });

  test('a show lists its episodes, the played one marked, and an episode plays from where it was left', async ({
    page
  }) => {
    const reports = await openKiosk(page, {
      podcasts: minuteLongShows(),
      report: { first_after_s: 1, every_s: 2 },
      audio: silentWav(60)
    });
    await page.getByRole('tab', { name: 'Podcasts' }).click();
    const panel = page.getByRole('tabpanel', { name: 'Podcasts' });
    await panel.getByRole('button', { name: 'Dagsnytt 18', exact: true }).click();
    const episodes = panel.getByRole('list', { name: 'Dagsnytt 18' }).getByRole('button');
    await expect(episodes).toHaveCount(2);
    await expect(episodes.nth(1)).toHaveAccessibleName(/Played$/);
    await expect(episodes.nth(0)).not.toHaveAccessibleName(/Played/);

    await episodes.nth(0).click();
    const pause = panel.getByRole('button', { name: 'Pause' });
    await expect(pause).toBeVisible();
    const position = panel.getByRole('slider', { name: 'Playback position' });
    await expect.poll(async () => Number(await position.inputValue())).toBeGreaterThanOrEqual(20);
    // NRK hears where it is a second in, and again as it plays.
    await expect.poll(() => reports.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    expect(reports[0]).toMatchObject({ podcast: 'dagsnytt_atten', episode: 'l_00000000-0000-4000-8000-000000000001' });
    expect(reports[0]?.position_s).toBeGreaterThanOrEqual(20);

    // Pausing says where it stopped.
    const before = reports.length;
    await pause.click();
    await expect(panel.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await expect.poll(() => reports.length).toBeGreaterThan(before);

    // Every control is big enough for a finger.
    const boxes = await Promise.all(
      ['Back 15 seconds', 'Play', 'Forward 30 seconds'].map(name =>
        panel.getByRole('button', { name, exact: true }).boundingBox()
      )
    );
    for (const box of boxes) expect(Math.min(box?.width ?? 0, box?.height ?? 0)).toBeGreaterThanOrEqual(64);

    // Forward 30 seconds moves the position on, and the lists keep the episode at their foot.
    const at = Number(await position.inputValue());
    await panel.getByRole('button', { name: 'Forward 30 seconds' }).click();
    await expect.poll(async () => Number(await position.inputValue())).toBeGreaterThanOrEqual(at + 29);
    await panel.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(panel.getByRole('button', { name: /^Open Dagsnytt 18 – 27\. november in the player$/ })).toBeVisible();
  });

  test('a kiosk whose owner has not linked NRK has no Podcasts tab', async ({ page }) => {
    await openKiosk(page, { linked: false });
    await expect(page.getByRole('tab', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('tab')).toHaveCount(3);
    await expect(page.getByRole('tab', { name: 'Podcasts' })).toHaveCount(0);
  });
});
