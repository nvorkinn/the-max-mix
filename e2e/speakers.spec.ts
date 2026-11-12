import { expect, test, type Page } from '@playwright/test';
import { airPlayOutput, fakeKioskOutputs } from './fake-kiosk.ts';
import { fakeSpotifySdk } from './fake-spotify-sdk.ts';
import { fakeSpotify, PIXEL } from './fake-spotify.ts';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Beside the artwork' });

test.describe('Speakers', { tag: '@speakers' }, () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 600 });
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
    );
  });

  test('open in the panel beside the artwork, mark the one that plays, and have no tabs away from the kiosk', async ({
    page
  }) => {
    await fakeSpotify(page);
    await page.goto('/');
    await page.getByRole('button', { name: /^Speakers: Playing on Test speaker/ }).click();
    const view = page.getByRole('region', { name: 'Speakers' });
    await expect(view.getByRole('checkbox', { name: 'Test speaker' })).toBeChecked();
    await expect(view.getByText('Playing', { exact: true })).toBeVisible();
    await expect(view.getByRole('group', { name: 'Kind of speaker' })).toHaveCount(0);
    // The artwork stays, and Queue brings the queue back.
    await expect(page.getByRole('region', { name: 'Now playing', exact: true })).toBeVisible();
    await nav(page).getByRole('button', { name: 'Queue' }).click();
    await expect(page.getByRole('region', { name: 'Upcoming tracks' })).toBeVisible();
    await expect(view).toBeHidden();
  });

  test.describe('on the kiosk, with this tablet as a player', () => {
    test('a speaker is only played on after Save, and AirPlay opens once this tablet plays', async ({ page }) => {
      const api = await fakeSpotify(page);
      const pi = await fakeKioskOutputs(page, [airPlayOutput('Kitchen', 60), airPlayOutput('Lounge', 20)]);
      await fakeSpotifySdk(page);
      await page.goto('/');
      await nav(page).getByRole('button', { name: 'Speakers' }).click();
      const view = page.getByRole('region', { name: 'Speakers' });
      const airPlayTab = view.getByRole('button', { name: 'AirPlay' });

      // Another speaker plays, so AirPlay only points at This tablet, in amber, and changes nothing.
      await expect(airPlayTab).toHaveAttribute('aria-disabled', 'true');
      // aria-disabled keeps the tab tappable, but Playwright's click waits for it to look enabled.
      await airPlayTab.dispatchEvent('click');
      await expect(view.getByRole('checkbox', { name: 'This tablet' })).toHaveClass(/is-flashing/);
      await expect(view.getByRole('checkbox', { name: 'This tablet' })).not.toBeChecked();

      // Ticking This tablet is only a draft until Save.
      await view.getByRole('checkbox', { name: 'This tablet' }).click();
      await expect(view.getByRole('checkbox', { name: 'This tablet' })).toBeChecked();
      expect(api.commands.filter(command => command.startsWith('PUT /v1/me/player?'))).toEqual([]);
      await nav(page).getByRole('button', { name: 'Save' }).click();
      await expect(nav(page).getByRole('button', { name: 'Speakers' })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Speakers: Playing on This tablet/ })).toBeVisible();

      // Now AirPlay opens; two speakers ticked and saved are routed by id, the louder one turned down first.
      await airPlayTab.click();
      const routed = pi.routes.length;
      await view.getByRole('checkbox', { name: 'Kitchen' }).click();
      await view.getByRole('checkbox', { name: 'Lounge' }).click();
      expect(pi.routes).toHaveLength(routed);
      await nav(page).getByRole('button', { name: 'Save' }).click();
      await expect(nav(page).getByRole('button', { name: 'Speakers' })).toBeVisible();
      expect(pi.routes.at(-1)).toEqual(['raop_sink.Kitchen.local.7000', 'raop_sink.Lounge.local.7000']);
      expect(pi.volumes).toEqual([{ output: 'raop_sink.Kitchen.local.7000', volume: 25 }]);
      await expect(page.getByRole('button', { name: /^Speakers: Playing on 2 speakers/ })).toBeVisible();

      // Each playing speaker's own volume, on request.
      await view.getByRole('button', { name: 'Volumes' }).click();
      const lounge = view.getByRole('slider', { name: 'Lounge volume' });
      await expect(lounge).toHaveValue('20');
      await lounge.fill('35');
      await expect.poll(() => pi.volumes.at(-1)).toEqual({ output: 'raop_sink.Lounge.local.7000', volume: 35 });

      // Moving to a Spotify speaker hands the sound back to the Pi's own output first.
      await view.getByRole('button', { name: 'Spotify Connect' }).click();
      await view.getByRole('checkbox', { name: 'Test speaker' }).click();
      await nav(page).getByRole('button', { name: 'Save' }).click();
      await expect(page.getByRole('button', { name: /^Speakers: Playing on Test speaker/ })).toBeVisible();
      expect(pi.routes.at(-1)).toEqual([]);
      await expect(airPlayTab).toHaveAttribute('aria-disabled', 'true');
    });
  });
});
