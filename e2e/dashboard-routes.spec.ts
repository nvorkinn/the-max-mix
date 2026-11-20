// cspell:ignore Jernbanetorget Snarøya Majorstuen Vestli Lillestrøm GZZLUEAC
import { expect, test, type Locator, type Page } from '@playwright/test';
import { DASHBOARD_NOW } from './dashboard.ts';
import { dashboardConfig, fakeCountdownServer, fakeFeed } from './fake-countdown.ts';
import { fakeSpotify } from './fake-spotify.ts';

// Grouped by route (the config's arrivals.group_by_route), a board has a row per route (line and destination) with its
// next time in front and the two after it on cards waiting behind it, instead of a row per departure.

const SCREENS = [{ width: 1280, height: 800 }] as const;

type Leg = readonly [line: string, destination: string, minutes: number, mode: string, platform: string | null];

function stop(source: 'tfl' | 'entur', id: string, name: string, mode: string, legs: readonly Leg[]) {
  const at = (minutes: number) => new Date(DASHBOARD_NOW.getTime() + minutes * 60_000).toISOString();
  return {
    source,
    id,
    departures: {
      fetched_at: DASHBOARD_NOW.toISOString(),
      stop_id: id,
      name,
      mode,
      stop_letter: null,
      modes: [],
      departures: legs.map(([line, destination, minutes, legMode, platform], index) => ({
        vehicle_id: source === 'tfl' ? `${id}-${String(index)}` : null,
        line,
        destination,
        expected_at: at(minutes),
        platform,
        mode: legMode
      }))
    }
  };
}

/** Elephant & Castle's Tube and Oslo's Jernbanetorget, each with routes that come round more than once. */
function londonAndOslo() {
  const north = 'Northbound - Platform 1';
  const south = 'Southbound - Platform 2';
  return {
    stops: [
      stop('tfl', '940GZZLUEAC', 'Elephant & Castle Underground Station', 'tube', [
        ['Northern', 'Morden', 2, 'tube', south],
        ['Bakerloo', 'Harrow & Wealdstone', 3, 'tube', north],
        ['Northern', 'High Barnet', 5, 'tube', north],
        ['Northern', 'Morden', 9, 'tube', south],
        ['Bakerloo', 'Harrow & Wealdstone', 10, 'tube', north],
        ['Northern', 'High Barnet', 12, 'tube', north],
        ['Northern', 'Morden', 15, 'tube', south],
        ['Northern', 'Edgware', 16, 'tube', north],
        ['Bakerloo', 'Harrow & Wealdstone', 18, 'tube', north],
        ['Northern', 'Morden', 21, 'tube', south]
      ]),
      stop('entur', 'NSR:StopPlace:4000', 'Jernbanetorget', 'metro', [
        ['31', 'Snarøya', 1, 'bus', 'C'],
        ['12', 'Majorstuen', 2, 'tram', 'A'],
        ['5', 'Vestli', 3, 'metro', '2'],
        ['31', 'Snarøya', 8, 'bus', 'C'],
        ['5', 'Vestli', 11, 'metro', '2'],
        ['12', 'Majorstuen', 12, 'tram', 'A'],
        ['VY190', 'Lillestrøm', 13, 'rail', '13'],
        ['31', 'Snarøya', 16, 'bus', 'C'],
        ['5', 'Vestli', 18, 'metro', '2']
      ])
    ]
  };
}

async function showGrouped(page: Page, screen: { width: number; height: number }) {
  await fakeSpotify(page);
  const config = dashboardConfig();
  await fakeCountdownServer(page, { ...config, arrivals: { ...config.arrivals, group_by_route: true } });
  await fakeFeed(page, DASHBOARD_NOW, { arrivals: londonAndOslo });
  await page.clock.setFixedTime(DASHBOARD_NOW);
  await page.setViewportSize(screen);
  await page.goto('/');
  await expect(page.locator('.dashboard-rows li')).toHaveCount(8);
}

/** A row's stack of times, front first: each item's slot and text. */
const stackOf = (row: Locator) =>
  row.locator('.dashboard-stack-item').evaluateAll(items =>
    items.map(
      item =>
        // eslint-disable-next-line unicorn/prefer-dom-node-text-content -- a card's hidden "min" must not count.
        `${(item as HTMLElement).dataset['slot'] ?? ''}:${(item as HTMLElement).innerText.replaceAll(/\s+/g, '')}`
    )
  );

for (const screen of SCREENS) {
  test(
    `a route shows once, its next time in front and the later ones on cards behind, at ${screen.width}x${screen.height}`,
    { tag: '@layout' },
    async ({ page }) => {
      await showGrouped(page, screen);
      const london = page.getByRole('region', { name: 'TfL Elephant & Castle' });
      const rows = london.locator('li');
      await expect(rows).toHaveCount(4);
      // Northern to Morden once, at 2 minutes, with 9, 15 and 21 waiting behind it.
      await expect(rows.nth(0)).toContainText('Morden');
      expect(await stackOf(rows.nth(0))).toEqual(['front:2min', 'card1:9', 'card2:15', 'card3:21']);
      await expect(rows.nth(1)).toContainText('Harrow & Wealdstone');
      expect(await stackOf(rows.nth(2))).toEqual(['front:5min', 'card1:12']);
      expect(await stackOf(rows.nth(3))).toEqual(['front:16min']);

      // The 2-minute train goes: the 9-minute card moves up to the front, and the others a place each.
      await page.clock.setFixedTime(new Date(DASHBOARD_NOW.getTime() + 3.5 * 60_000));
      const morden = rows.filter({ hasText: 'Morden' });
      await expect.poll(() => stackOf(morden)).toEqual(['front:6min', 'card1:12', 'card2:18']);
    }
  );
}
