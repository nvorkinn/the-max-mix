import { expect, test, type Page } from '@playwright/test';
import { fakeSpotifySdk } from './fake-spotify-sdk.ts';
import { fakeSpotify, PIXEL } from './fake-spotify.ts';

/** The kiosk's audio service: it lists two AirPlay speakers, and every route request it is sent is kept. */
async function fakeKioskAudio(page: Page) {
  const routes: string[][] = [];
  await page.route('http://127.0.0.1:7341/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/speakers') return route.fulfill({ json: { speakers: ['Kitchen', 'Lounge'] } });
    if (pathname === '/audio/route') {
      routes.push((route.request().postDataJSON() as { speakers: string[] }).speakers);
    }
    return route.fulfill({ status: 204 });
  });
  return routes;
}

/** A list of routes without a request that repeats the one before it. */
const withoutRepeats = (routes: string[][]) =>
  routes.filter((route, index) => index === 0 || route.join('|') !== routes[index - 1]?.join('|'));

test.describe('Speakers', { tag: '@speakers' }, () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 600 });
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
    );
    await fakeSpotify(page);
  });

  test('lists the Spotify speakers, marks the one that plays, and has no AirPlay away from the kiosk', async ({
    page
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /^Speakers: Playing on Test speaker/ }).click();
    const drawer = page.getByRole('dialog', { name: 'Speakers' });
    await expect(drawer.getByRole('button', { name: /Test speaker/ })).toHaveAttribute('aria-pressed', 'true');
    // Away from the kiosk there is no AirPlay.
    await expect(drawer.getByRole('button', { name: 'AirPlay' })).toHaveCount(0);
  });

  test.describe('on the kiosk, with this tablet as a player', () => {
    test('AirPlay speakers can be picked once this tablet plays, and are handed back with a Spotify speaker', async ({
      page
    }) => {
      const routes = await fakeKioskAudio(page);
      await page.addInitScript(() => {
        localStorage.setItem('maxmix.kiosk', 'true');
      });
      await fakeSpotifySdk(page);
      await page.goto('/');
      await page.getByRole('button', { name: /^Speakers:/ }).click();
      const drawer = page.getByRole('dialog', { name: 'Speakers' });

      // Another speaker plays, so AirPlay and Bluetooth have nothing to send on yet.
      const airPlayTab = drawer.getByRole('button', { name: 'AirPlay' });
      await expect(drawer.getByRole('button', { name: 'This tablet' })).toBeVisible();
      await expect(airPlayTab).toBeDisabled();
      await expect(drawer.getByRole('button', { name: 'Bluetooth' })).toBeDisabled();

      await drawer.getByRole('button', { name: 'This tablet' }).click();
      await expect(drawer.getByRole('button', { name: 'This tablet' })).toHaveAttribute('aria-pressed', 'true');
      await expect(airPlayTab).toBeEnabled();
      await airPlayTab.click();
      const kitchen = drawer.getByRole('button', { name: /Kitchen/ });
      const lounge = drawer.getByRole('button', { name: /Lounge/ });
      // Once the Pi has listed it, a speaker that is there shows only its name.
      await expect(kitchen).toHaveText(/^\s*Kitchen\s*$/);

      await kitchen.click();
      await expect(kitchen).toHaveAttribute('aria-pressed', 'true');
      await lounge.click();
      await expect(lounge).toHaveAttribute('aria-pressed', 'true');
      await kitchen.click();
      await expect(kitchen).toHaveAttribute('aria-pressed', 'false');
      // (Each tap asks the Pi to route twice, from the list and from the page; it is the same request, so it is counted once.)
      expect(withoutRepeats(routes)).toEqual([['Kitchen'], ['Kitchen', 'Lounge'], ['Lounge']]);
      // The control bar says where the sound goes.
      await expect(page.getByRole('button', { name: /^Speakers: Playing on AirPlay, 1 speaker/ })).toBeVisible();

      // Picking a Spotify speaker hands the sound back to the Pi's own output.
      await drawer.getByRole('button', { name: 'Spotify Connect' }).click();
      await drawer.getByRole('button', { name: /Test speaker/ }).click();
      await expect(drawer.getByRole('button', { name: /Test speaker/ })).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => routes.at(-1)).toEqual([]);
      await expect(airPlayTab).toBeDisabled();
    });
  });
});
