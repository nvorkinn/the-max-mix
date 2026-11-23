// cspell:ignore Kjelsås Vestli
import { expect, test, type Page } from '@playwright/test';
import { showDashboard } from './dashboard.ts';
import { arrivalsAt, stationsAt } from './fake-countdown.ts';

// A kiosk with several stops gives each stop its own board, whatever its modes, two at a time in the usual two
// places. Every 15 seconds they move along by one: the left one leaves, the right one moves over, the next comes in.

const SCREENS = [{ width: 1280, height: 800 }] as const;

const NOW = new Date('2026-11-17T09:20:00Z');
const TURN_MS = 15_000;

/** The two boards showing, left then right: which board each is, and where it is. */
async function showing(page: Page) {
  const board = (slot: number) =>
    page.locator(`.dashboard-departures-slot[data-slot="${slot}"]`).evaluate(element => {
      // Measure the settled position without waiting for the real-time slide.
      for (const animation of element.getAnimations()) animation.finish();
      const { x, y, width, height } = element.getBoundingClientRect();
      return { stop: element.dataset['board'] ?? '', box: [x, y, width, height].map(value => Math.round(value)) };
    });
  return Promise.all([board(0), board(1)]);
}

for (const screen of SCREENS) {
  for (const count of [3, 6]) {
    test(
      `${count} stops move along one at a time at ${screen.width}x${screen.height}`,
      { tag: '@layout' },
      async ({ page }) => {
        await page.clock.install({ time: NOW });
        const reference = arrivalsAt(NOW, false);
        let hasMoreStops = false;
        await showDashboard(
          page,
          screen,
          {
            arrivals: () => (hasMoreStops ? stationsAt(NOW, count) : reference),
            retryMs: () => (hasMoreStops ? 60_000 : 100)
          },
          6,
          NOW
        );
        const places = (await showing(page)).map(board => board.box);

        // The next feed connection brings the additional stops into the same Dashboard.
        hasMoreStops = true;
        await expect(page.locator('.dashboard-rows li')).toHaveCount(count * 4);
        // The feed has arrived. Pause the clock so wall time between turns cannot move the carousel.
        await page.clock.setSystemTime(new Date(NOW.getTime() - 1000));
        await page.clock.pauseAt(NOW);
        const lefts: string[] = [];
        let right = '';
        /* eslint-disable no-await-in-loop -- one turn after another */
        for (let turn = 0; turn < count; turn++) {
          // Two seconds into each turn, the previous right board is now on the left.
          await page.clock.fastForward(turn === 0 ? 2000 : TURN_MS);
          if (turn > 0) {
            await expect(page.locator('.dashboard-departures-slot[data-slot="0"]')).toHaveAttribute(
              'data-board',
              right
            );
          }
          const [leftBoard, rightBoard] = await showing(page);
          expect([leftBoard.box, rightBoard.box]).toEqual(places);
          lefts.push(leftBoard.stop);
          right = rightBoard.stop;
        }
        /* eslint-enable no-await-in-loop */
        // Every stop has had its turn on the left.
        expect(new Set(lefts).size).toBe(count);
      }
    );
  }
}

/** A Tube station and an Entur station serving the metro and trams (Oslo's Majorstuen), read at NOW. */
function londonAndOslo() {
  const answer = stationsAt(NOW, 2);
  const [first, second] = answer.stops;
  if (!first || !second) throw new Error('too few stops');
  const [metro, tram] = second.departures.departures;
  if (!metro || !tram) throw new Error('too few departures');
  return {
    stops: [
      first,
      {
        ...second,
        source: 'entur',
        departures: {
          ...second.departures,
          name: 'Majorstuen',
          mode: 'metro',
          modes: ['metro', 'tram'],
          departures: [
            { ...metro, vehicle_id: null, line: '5', destination: 'Vestli', platform: '2', mode: 'metro' },
            { ...tram, vehicle_id: null, line: '12', destination: 'Kjelsås', platform: 'C', mode: 'tram' }
          ]
        }
      }
    ]
  };
}

for (const screen of SCREENS) {
  test(
    `a London stop carries the roundel and a Norwegian one Ruter's mark, its modes on one board, at ${screen.width}x${screen.height}`,
    { tag: '@layout' },
    async ({ page }) => {
      await showDashboard(page, screen, { arrivals: londonAndOslo }, 6);
      await expect(page.getByRole('region', { name: 'TfL Elephant & Castle' })).toBeVisible();
      const oslo = page.getByRole('region', { name: 'Ruter Majorstuen' });
      await expect(oslo).toBeVisible();
      await expect(oslo.getByRole('img', { name: 'TfL' })).toHaveCount(0);
      // The metro and the tram on the one board, each a route number in its mode's colour.
      await expect(oslo.locator('li')).toHaveCount(2);
      await expect(oslo.getByText('5', { exact: true })).toHaveAttribute('data-mode', 'metro');
      await expect(oslo.getByText('12', { exact: true })).toHaveAttribute('data-mode', 'tram');
      await expect(oslo.getByText('Stop C')).toBeVisible();
    }
  );
}
