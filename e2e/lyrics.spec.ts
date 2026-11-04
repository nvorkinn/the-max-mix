import { expect, test } from '@playwright/test';
import { fakeSpotify } from './fake-spotify.ts';

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const syncedLyrics = Array.from({ length: 120 }, (_, index) => {
  const seconds = index * 2;
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  return `[${minutes}:${(seconds % 60).toString().padStart(2, '0')}.00]Placeholder line ${index}`;
}).join('\n');

for (const { viewport, appearance } of [{ viewport: { width: 1024, height: 600 }, appearance: 'minimal' }]) {
  test(`lyric reading and follow fit ${viewport.width}x${viewport.height} in ${appearance}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
    );
    await page.route('https://lrclib.net/api/**', route =>
      route.fulfill({ json: { instrumental: false, syncedLyrics } })
    );
    await page.addInitScript(theme => {
      /* eslint-disable n/no-unsupported-features/node-builtins -- This init script runs in the browser, not Node. */
      localStorage.setItem('maxmix_theme', theme);
      localStorage.setItem('maxmix_lyrics', 'on');
      /* eslint-enable n/no-unsupported-features/node-builtins */
    }, appearance);
    await fakeSpotify(page);
    await page.goto('/');
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
    const readingTop = await list.evaluate(element => element.scrollTop);
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
}
