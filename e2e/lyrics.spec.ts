import { expect, test } from '@playwright/test';
import { fakeSpotify, PIXEL } from './fake-spotify.ts';
import { openSpotifyTab } from './spotify-tab.ts';

const syncedLyrics = Array.from({ length: 120 }, (_, index) => {
  const seconds = index * 2;
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  return `[${minutes}:${(seconds % 60).toString().padStart(2, '0')}.00]Placeholder line ${index}`;
}).join('\n');

test.describe('Lyrics', { tag: '@lyrics' }, () => {
  test('lyric reading and follow fit 1280x800', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
    );
    await fakeSpotify(page);
    // After fakeSpotify, whose own answer (no lyrics) this one takes over from.
    await page.route('https://lrclib.net/api/**', route =>
      route.fulfill({ json: { instrumental: false, syncedLyrics } })
    );
    await openSpotifyTab(page);
    // The song has lyrics, so the panel opens on them, though songs are queued.
    await expect(page.getByRole('button', { name: 'Lyrics', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const panel = page.getByRole('region', { name: 'Lyrics', exact: true });
    const list = panel.getByRole('list');
    const active = list.locator('[aria-current="true"]');
    const centerOffset = () =>
      list.evaluate(element => {
        const line = element.querySelector('[aria-current="true"]');
        if (!(line instanceof HTMLElement)) throw new TypeError('Missing active lyric line');
        return Math.abs(line.offsetTop - element.scrollTop - element.clientHeight / 2 + line.clientHeight / 2);
      });
    await expect(list).toBeVisible();
    await list.scrollIntoViewIfNeeded();
    await expect.poll(centerOffset).toBeLessThan(2);
    await page.clock.install();
    const initialTop = await list.evaluate(element => element.scrollTop);
    // A finger on the list pauses the following, and the reader drags it up to read. Dragged here at once: a wheel's
    // smooth scroll keeps moving for a while on a busy machine, and a pause in it is not where the reader stopped.
    await list.hover();
    await page.mouse.down();
    await expect(list).toHaveAttribute('data-following', 'false');
    const readingTop = await list.evaluate((element, top) => {
      element.scrollTo({ top, behavior: 'instant' });
      return element.scrollTop;
    }, initialTop - 300);
    await page.mouse.up();
    expect(readingTop).toBeLessThan(initialTop);
    const initialLine = await active.textContent();
    await page.clock.fastForward(5000);
    await expect(active).not.toHaveText(initialLine ?? '');
    expect(Math.abs((await list.evaluate(element => element.scrollTop)) - readingTop)).toBeLessThan(2);

    // Left alone for a few seconds, the lyrics follow the song again.
    expect(await page.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.clock.fastForward(9000);
    await expect(list).toHaveAttribute('data-following', 'true');
    await expect.poll(centerOffset).toBeLessThan(2);

    await list.focus();
    await page.keyboard.press('Home');
    await expect(list).toHaveAttribute('data-following', 'false');
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(0);
    await page.clock.fastForward(5000);
    expect(await list.evaluate(element => element.scrollTop)).toBe(0);
    await page.getByRole('button', { name: 'Next track' }).click();
    await expect(list).toHaveAttribute('aria-label', 'Lyrics of Starboy');
    await expect(list).toHaveAttribute('data-following', 'true');
  });

  test('tapping Lyrics again syncs the lyrics to the line tapped next', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
    );
    await fakeSpotify(page);
    // After fakeSpotify, whose own answer (no lyrics) this one takes over from.
    await page.route('https://lrclib.net/api/**', route =>
      route.fulfill({ json: { instrumental: false, syncedLyrics } })
    );
    await openSpotifyTab(page);
    // No clock tricks here: the position the page projects and the one the fake Spotify reports must agree.
    const lyricsButton = page.getByRole('button', { name: 'Lyrics', exact: true });
    await expect(lyricsButton).toHaveAttribute('aria-pressed', 'true');
    const list = page.getByRole('region', { name: 'Lyrics', exact: true }).getByRole('list');
    const active = list.locator('[aria-current="true"]');
    const lineNumber = async () => Number((await active.textContent())?.replace('Placeholder line ', ''));
    await expect(active).toBeVisible();
    await lyricsButton.click();
    await expect(lyricsButton).toHaveClass(/is-syncing/);
    const later = (await lineNumber()) + 3;
    await list.getByRole('button', { name: `Placeholder line ${later}`, exact: true }).click();
    // The tapped line is the one being sung now; a line lasts two seconds, so the next may have started already.
    await expect.poll(lineNumber).toBeGreaterThanOrEqual(later);
    expect(await lineNumber()).toBeLessThanOrEqual(later + 1);
    await expect(lyricsButton).not.toHaveClass(/is-syncing/);
    await expect(list.getByRole('button')).toHaveCount(0);
  });
});
