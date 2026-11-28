import { expect, test, type Page } from '@playwright/test';
import { DASHBOARD_NOW } from './dashboard.ts';
import { dashboardConfig, fakeCountdownServer, fakeFeed } from './fake-countdown.ts';
import { fakeKioskOutputs } from './fake-kiosk.ts';
import { fakeSpotify, PIXEL } from './fake-spotify.ts';

const CORS = { 'Access-Control-Allow-Origin': '*' };

const WORKTOP = { id: 'light.kitchen', name: 'Worktop', on: true, brightness: 40, dimmable: true, available: true };
const TABLE = { id: 'light.table', name: 'Table', on: false, brightness: null, dimmable: true, available: true };
const KETTLE = { id: 'switch.kettle', name: 'Kettle', on: true, brightness: null, dimmable: false, available: true };

/**
 * Fakes the lights of the Pi's service (server/src/lights.ts) with this status, on a kiosk owned and through its setup.
 * A light that is switched changes in the status, as Home Assistant would report it. Returns what was asked for.
 */
async function fakeLights(page: Page, status: { state: string; lights: (typeof WORKTOP | typeof TABLE)[] }) {
  const asked: unknown[] = [];
  await fakeSpotify(page);
  await fakeCountdownServer(page, dashboardConfig());
  await fakeFeed(page, DASHBOARD_NOW);
  await fakeKioskOutputs(page, []);
  await page.route('http://127.0.0.1:7341/lights/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/lights/config') return route.fulfill({ headers: CORS, json: status });
    if (path === '/lights/events') {
      const headers = { ...CORS, 'Content-Type': 'text/event-stream' };
      return route.fulfill({ headers, body: `data: ${JSON.stringify(status)}\n\n` });
    }
    const change = request.postDataJSON() as { id: string; on: boolean; brightness?: number };
    asked.push(change);
    const light = status.lights.find(candidate => candidate.id === change.id);
    if (light) Object.assign(light, { on: change.on, brightness: change.on ? (change.brightness ?? 100) : null });
    return route.fulfill({ status: 204, headers: CORS });
  });
  await page.route('https://images.unsplash.com/**', route =>
    route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
  );
  await page.clock.setFixedTime(DASHBOARD_NOW);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/?kiosk=1');
  return asked;
}

test.describe('Lights', { tag: '@lights' }, () => {
  test('a kiosk with lights has a Lights tab, which shows each light and switches it', async ({ page }) => {
    const asked = await fakeLights(page, { state: 'ready', lights: [{ ...WORKTOP }, { ...TABLE }, { ...KETTLE }] });
    await page.getByRole('tab', { name: 'Lights' }).click();
    const panel = page.getByRole('tabpanel', { name: 'Lights' });
    const worktop = panel.getByRole('button', { name: 'Worktop' });
    await expect(worktop).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByRole('slider', { name: 'Brightness of Worktop' })).toHaveValue('40');
    await expect(panel.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'false');
    // The kettle's socket does not dim, so it has no slider.
    await expect(panel.getByRole('slider')).toHaveCount(2);
    await worktop.click();
    await expect(worktop).toHaveAttribute('aria-pressed', 'false');
    await panel.getByRole('slider', { name: 'Brightness of Table' }).fill('60');
    await expect(panel.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(() => asked)
      .toEqual([
        { id: 'light.kitchen', on: false },
        { id: 'light.table', on: true, brightness: 60 }
      ]);
    // Every control is big enough for a finger.
    const box = await worktop.boundingBox();
    expect(Math.min(box?.width ?? 0, box?.height ?? 0)).toBeGreaterThanOrEqual(48);
  });

  test('says so when the kiosk is not signed in to Home Assistant', async ({ page }) => {
    await fakeLights(page, { state: 'signed-out', lights: [{ ...WORKTOP }] });
    await page.getByRole('tab', { name: 'Lights' }).click();
    const panel = page.getByRole('tabpanel', { name: 'Lights' });
    await expect(panel.getByRole('status')).toContainText('not signed in to Home Assistant');
    await expect(panel.getByRole('button', { name: 'Worktop' })).toHaveCount(0);
  });

  test('a kiosk without lights has no Lights tab', async ({ page }) => {
    await fakeLights(page, { state: 'off', lights: [] });
    await expect(page.getByRole('tab', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('tab')).toHaveCount(3);
  });
});
