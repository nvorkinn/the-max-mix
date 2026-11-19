import { expect, test, type Page } from '@playwright/test';
import { showDashboard } from './dashboard.ts';

// The Dashboard's layout never depends on its data: names too long for a board and an empty notice board leave every
// panel, board and departure row where it is with the usual data.

const SCREENS = [{ width: 1280, height: 800 }] as const;

/** The panels, the boards and their rows. */
const PARTS = '.dashboard-rail > *, .dashboard-sky, .dashboard-departures > *, .dashboard-rows li';

/** Where each part is on the screen, in document order. */
async function layout(page: Page): Promise<(string | number)[][]> {
  return page.locator(PARTS).evaluateAll(elements =>
    elements.map(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return [element.getAttribute('class') ?? '', Math.round(x), Math.round(y), Math.round(width), Math.round(height)];
    })
  );
}

for (const screen of SCREENS) {
  test(
    `long names and no notices keep the Dashboard's layout at ${screen.width}x${screen.height}`,
    {
      tag: '@layout'
    },
    async ({ page }) => {
      await showDashboard(page, screen);
      const usual = await layout(page);

      await showDashboard(page, screen, { long: true, none: true });
      await expect(page.getByText(/Harrow & Wealdstone via/)).toBeVisible();

      expect(await layout(page)).toEqual(usual);
    }
  );
}
