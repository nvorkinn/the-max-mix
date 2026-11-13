import { expect, test } from '@playwright/test';
import { fakeSpotify, PIXEL } from './fake-spotify.ts';

const syncedLyrics = Array.from({ length: 120 }, (_, index) => {
  const seconds = index * 2;
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  return `[${minutes}:${(seconds % 60).toString().padStart(2, '0')}.00]Placeholder line ${index}`;
}).join('\n');

test.describe('Lyrics', { tag: '@lyrics' }, () => {
  test('lyric reading and follow fit 1024x600', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 600 });
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
    );
    await page.route('https://lrclib.net/api/**', route =>
      route.fulfill({ json: { instrumental: false, syncedLyrics } })
    );
    await fakeSpotify(page);
    await page.goto('/');
    // Songs are queued, so the queue shows first; the Lyrics button beside the panel fades to the lyrics.
    await expect(page.getByRole('region', { name: 'Upcoming tracks' })).toBeVisible();
    await page.getByRole('button', { name: 'Lyrics', exact: true }).click();
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
    await list.hover();
    await page.mouse.wheel(0, -900);
    await expect(list).toHaveAttribute('data-following', 'false');
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeLessThan(initialTop);
    // The wheel scrolls smoothly, so the list is still moving when it first goes up: wait for it to come to rest.
    let lastTop = NaN;
    await expect
      .poll(async () => {
        const top = await list.evaluate(element => element.scrollTop);
        const isResting = top === lastTop;
        lastTop = top;
        return isResting;
      })
      .toBe(true);
    const readingTop = lastTop;
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
});
