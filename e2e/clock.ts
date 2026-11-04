import type { Page } from '@playwright/test';

/**
 * Moves a page's fake clock (page.clock.install, then pauseAt) on `step` milliseconds at a time, giving each read the app
 * starts a moment to finish before the next timer fires: the clock is fake, the network is not.
 */
export async function advance(page: Page, milliseconds: number, step = 1000) {
  /* eslint-disable no-await-in-loop -- Each step has to complete before the next one. */
  for (let elapsed = 0; elapsed < milliseconds; elapsed += step) {
    await page.clock.runFor(step);
    await page.waitForTimeout(25);
  }
  /* eslint-enable no-await-in-loop */
}
