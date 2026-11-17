import { expect, type Page } from '@playwright/test';
import { dashboardConfig, fakeCountdownServer, fakeFeed } from './fake-countdown.ts';
import { fakeSpotify } from './fake-spotify.ts';

/** The time the Dashboard tests fix the page's clock at: Tuesday 17 November 2026, 09:20 in London. */
const DASHBOARD_NOW = new Date('2026-11-17T09:20:00Z');

/**
 * Opens the Dashboard of an owned kiosk on `screen`, its data from the fake live feed (`feed` gives names too long for
 * the boards, no notices or other stops), once the boards have their `rows` departures.
 */
export async function showDashboard(
  page: Page,
  screen: { width: number; height: number },
  feed: Parameters<typeof fakeFeed>[2] = {},
  rows = 6
) {
  await fakeSpotify(page);
  await fakeCountdownServer(page, dashboardConfig());
  await fakeFeed(page, DASHBOARD_NOW, feed);
  await page.clock.setFixedTime(DASHBOARD_NOW);
  await page.setViewportSize(screen);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Tube' }).first()).toBeVisible();
  await expect(page.locator('.dashboard-rows li')).toHaveCount(rows);
}
