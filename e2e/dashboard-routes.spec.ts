// cspell:ignore Jernbanetorget Snarøya Majorstuen Vestli Lillestrøm GZZLUEAC
import { expect, test, type Page } from '@playwright/test';
import { DASHBOARD_NOW } from './dashboard.ts';
import { dashboardConfig, fakeCountdownServer, fakeFeed } from './fake-countdown.ts';
import { fakeSpotify } from './fake-spotify.ts';

// Grouped by route (the config's arrivals.group_by_route), a board has a row per route (line and destination) with its
// next time, and the next two after it small under it, instead of a row per departure.

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

for (const screen of SCREENS) {
  test(
    `a route shows once, with its next times, at ${screen.width}x${screen.height}`,
    { tag: '@layout' },
    async ({ page }) => {
      await showGrouped(page, screen);
      const london = page.getByRole('region', { name: 'TfL Elephant & Castle' });
      const rows = london.locator('li');
      await expect(rows).toHaveCount(4);
      // Northern to Morden once, at 2 minutes, then 9 and 15; Edgware (16) and the fourth Morden (21) don't fit.
      await expect(rows.nth(0)).toContainText('Morden');
      await expect(rows.nth(0).locator('.dashboard-mins')).toHaveText('2min');
      await expect(rows.nth(0).locator('.dashboard-later')).toHaveText('9 · 15');
      await expect(rows.nth(1)).toContainText('Harrow & Wealdstone');
      await expect(rows.nth(2)).toContainText('High Barnet');
      await expect(rows.nth(2).locator('.dashboard-later')).toHaveText('12');
      await expect(rows.nth(3)).toContainText('Edgware');
      await expect(rows.nth(3).locator('.dashboard-later')).toHaveCount(0);

      const oslo = page.getByRole('region', { name: 'Ruter Jernbanetorget' });
      await expect(oslo.locator('li')).toHaveCount(4);
      await expect(oslo.locator('li').nth(0).locator('.dashboard-later')).toHaveText('8 · 16');
    }
  );
}
