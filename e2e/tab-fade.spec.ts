import { expect, test } from '@playwright/test';
import { runningFades } from './crossfade.ts';
import { dashboardConfig, fakeCountdownServer, fakeFeed } from './fake-countdown.ts';
import { fakeSpotify, PIXEL } from './fake-spotify.ts';
import { openSpotifyTab } from './spotify-tab.ts';

test.describe('Tab crossfade', { tag: '@layout' }, () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
    );
    await fakeSpotify(page);
    // An owned kiosk's live feed, so the Dashboard has its boards.
    await fakeCountdownServer(page, dashboardConfig());
    await fakeFeed(page, new Date());
    await openSpotifyTab(page);
    await expect(page.getByRole('tab', { name: 'Spotify' })).toHaveAttribute('aria-selected', 'true');
  });

  test('changing tab fades the whole screen over 300 ms', async ({ page }) => {
    await page.getByRole('tab', { name: 'Dashboard' }).click();
    // The fade starts a frame after the tap, so wait for it to show up.
    await expect.poll(async () => (await runningFades(page)).length > 0).toBe(true);
    expect((await runningFades(page)).filter(duration => duration !== 300)).toEqual([]);
    await expect(page.getByRole('region', { name: /^TfL / }).first()).toBeVisible();
  });

  test('rapid taps between the tabs end on the last one tapped, with no fade left behind', async ({ page }) => {
    // One tap every 40 ms, far faster than the 300 ms fade. Only the tab bar showing takes each tap.
    await page.evaluate(async () => {
      const names = ['Dashboard', 'Settings', 'Spotify', 'Dashboard', 'Spotify', 'Settings', 'Dashboard'];
      for (const name of names) {
        const bar = [...globalThis.document.querySelectorAll<HTMLElement>('[role="tab"]')];
        bar.find(tab => tab.textContent === name && tab.offsetParent !== null)?.click();
        // eslint-disable-next-line no-await-in-loop -- one tap after the other
        await new Promise(resolve => setTimeout(resolve, 40));
      }
    });
    await expect(page.getByRole('tabpanel', { name: 'Dashboard' })).toBeVisible();
    await expect.poll(() => runningFades(page)).toEqual([]);
    // Still takes taps afterwards.
    await page.getByRole('tab', { name: 'Spotify' }).click();
    await expect(page.getByRole('tabpanel', { name: 'Spotify' })).toBeVisible();
  });

  test('the Dashboard stays mounted while another tab shows', async ({ page }) => {
    await page.getByRole('tab', { name: 'Dashboard' }).click();
    await expect(page.getByRole('region', { name: /^TfL / }).first()).toBeVisible();
    await page.getByRole('tab', { name: 'Spotify' }).click();
    await expect(page.getByRole('region', { name: /^TfL /, includeHidden: true }).first()).toBeAttached();
  });

  test('the photo pans toward the side of the tab shown, in the fade', async ({ page }) => {
    // How far the photo showing is moved sideways, in pixels, once the pan has finished.
    const photoShift = async () => {
      await expect
        .poll(() =>
          page.evaluate(() =>
            globalThis.document
              .getAnimations()
              .some(a => (a as CSSAnimation).animationName === 'dashboard-backdrop-pan')
          )
        )
        .toBe(false);
      return page.evaluate(() => {
        const photo = [...globalThis.document.querySelectorAll<HTMLElement>('.dashboard-backdrop')].find(
          element => element.offsetParent !== null || element.getClientRects().length > 0
        );
        return photo ? Number(globalThis.getComputedStyle(photo).transform.split(',', 5)[4] ?? 0) : null;
      });
    };
    // Spotify, on the left, looks a little to the left of the photo, which moves it right.
    expect(await photoShift()).toBeGreaterThan(20);
    await page.getByRole('tab', { name: 'Dashboard' }).click();
    // The pan runs with the fade, for the same 300 ms.
    await expect
      .poll(() =>
        page.evaluate(() =>
          globalThis.document
            .getAnimations()
            .filter(a => (a as CSSAnimation).animationName === 'dashboard-backdrop-pan')
            .map(a => Number(a.effect?.getTiming().duration))
        )
      )
      .toEqual([300]);
    expect(await photoShift()).toBe(0);
    await page.getByRole('tab', { name: 'Settings' }).click();
    await expect(page.getByRole('tabpanel', { name: 'Settings' })).toBeVisible();
    expect(await photoShift()).toBeLessThan(-20);
  });

  test('with less motion asked for, the photo does not pan', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('tab', { name: 'Dashboard' }).click();
    await expect(page.getByRole('tabpanel', { name: 'Dashboard' })).toBeVisible();
    expect(
      await page.evaluate(() =>
        globalThis.document
          .getAnimations()
          .filter(a => (a as CSSAnimation).animationName === 'dashboard-backdrop-pan')
          .map(a => (a as CSSAnimation).animationName)
      )
    ).toEqual([]);
  });
});
