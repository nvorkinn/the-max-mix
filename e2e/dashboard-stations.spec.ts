import { expect, test, type Page } from '@playwright/test';
import { showDashboard } from './dashboard.ts';
import { stationsAt } from './fake-countdown.ts';

// A kiosk with several stops gives each Tube station and bus stop its own board, two at a time in the usual two
// places, the next pair every 15 seconds.

const SCREENS = [
  { width: 1024, height: 600 },
  { width: 1280, height: 800 }
] as const;

const NOW = new Date('2026-11-17T09:20:00Z');
const PAGE_MS = 15_000;

/** The stops on the boards showing, and where those boards are. */
async function showing(page: Page) {
  return page.locator('.dashboard-departures-page[data-shown="true"] .dashboard-board').evaluateAll(elements =>
    elements.map(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      const stop = element.querySelector('.dashboard-board-stop')?.textContent.trim() ?? '';
      return { stop, box: [x, y, width, height].map(value => Math.round(value)) };
    })
  );
}

for (const screen of SCREENS) {
  for (const count of [3, 6]) {
    test(
      `${count} stops take turns two at a time at ${screen.width}x${screen.height}`,
      { tag: '@layout' },
      async ({ page }) => {
        await showDashboard(page, screen);
        const places = (await showing(page)).map(board => board.box);
        expect(places).toHaveLength(2);

        await showDashboard(page, screen, { arrivals: () => stationsAt(NOW, count) }, count * 4);
        const seen: string[] = [];
        /* eslint-disable no-await-in-loop -- each pair shows in turn */
        for (let turn = 0; turn < Math.ceil(count / 2); turn++) {
          await page.clock.setFixedTime(new Date(NOW.getTime() + turn * PAGE_MS));
          await expect.poll(async () => (await showing(page)).map(board => board.stop)).not.toEqual(seen.slice(-2));
          const boards = await showing(page);
          // The pair sits where the usual two boards do, each board at full height.
          expect(boards.map(board => board.box)).toEqual(places.slice(0, boards.length));
          seen.push(...boards.map(board => board.stop));
        }
        /* eslint-enable no-await-in-loop */
        expect(seen).toHaveLength(count);
      }
    );
  }
}
