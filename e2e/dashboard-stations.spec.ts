import { expect, test } from '@playwright/test';
import { showDashboard } from './dashboard.ts';
import { stationsAt } from './fake-countdown.ts';

// A kiosk with several stops gives each Tube station and bus stop its own board: up to three side by side, then two
// deep with two rows each, every board and row inside the departures area and none overlapping.

const SCREENS = [
  { width: 1024, height: 600 },
  { width: 1280, height: 800 }
] as const;

const NOW = new Date('2026-11-17T09:20:00Z');

for (const screen of SCREENS) {
  for (const [count, rows] of [
    [3, 4],
    [4, 2],
    [6, 2]
  ] as const) {
    test(
      `${count} stops get a board each at ${screen.width}x${screen.height}`,
      { tag: '@layout' },
      async ({ page }) => {
        await showDashboard(page, screen, { arrivals: () => stationsAt(NOW, count) }, count * rows);
        const area = await page.locator('.dashboard-departures').boundingBox();
        const boards = await page.locator('.dashboard-board').evaluateAll(elements =>
          elements.map(element => {
            const { x, y, width, height } = element.getBoundingClientRect();
            const hasRowsInside = [...element.querySelectorAll('li')].every(row => {
              const box = row.getBoundingClientRect();
              return box.top >= y - 0.5 && box.bottom <= y + height + 0.5;
            });
            return { x, y, width, height, hasRowsInside };
          })
        );

        expect(boards).toHaveLength(count);
        for (const [index, board] of boards.entries()) {
          expect(board.hasRowsInside).toBe(true);
          expect(board.x).toBeGreaterThanOrEqual((area?.x ?? 0) - 0.5);
          expect(board.y + board.height).toBeLessThanOrEqual((area?.y ?? 0) + (area?.height ?? 0) + 0.5);
          const later = boards.slice(index + 1);
          for (const other of later) {
            const isApart =
              other.x >= board.x + board.width ||
              board.x >= other.x + other.width ||
              other.y >= board.y + board.height ||
              board.y >= other.y + other.height;
            expect(isApart).toBe(true);
          }
        }
      }
    );
  }
}
