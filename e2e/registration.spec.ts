import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { PIXEL } from './fake-spotify.ts';

// The countdown-server the build names (.env.production).
const REGISTER = 'https://app.countdown.build/register';

/**
 * Stands in for countdown-server's /register page: answers each visit with what the real one sends back once the
 * person has signed in and confirmed, a 303 to `return_to` with `device_id` (or `error`). Returns the visits.
 */
async function fakeRegisterPage(page: Page, answer: Record<string, string>) {
  const visits: URL[] = [];
  await page.route(`${REGISTER}**`, (route: Route) => {
    const visit = new URL(route.request().url());
    visits.push(visit);
    const back = new URL(visit.searchParams.get('return_to') ?? '');
    for (const [name, value] of Object.entries(answer)) back.searchParams.set(name, value);
    return route.fulfill({ status: 303, headers: { Location: back.href } });
  });
  return visits;
}

test.describe('Registering with countdown-server', { tag: '@registration' }, () => {
  // A kiosk that has never registered (the other tests start registered: see playwright.config.ts).
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    await page.route('https://images.unsplash.com/**', route =>
      route.fulfill({ status: 200, contentType: 'image/gif', body: PIXEL })
    );
  });

  test('a new kiosk registers, keeps its device ID and opens the app', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 600 });
    const visits = await fakeRegisterPage(page, { device_id: '0a1b2c3d4e5f' });
    await page.goto('/?kiosk=1');

    await expect(page.getByRole('tabpanel', { name: 'Dashboard' })).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
    const stored = await page.evaluate(() => ({
      secret: localStorage.getItem('maxmix.deviceSecret'),
      deviceId: localStorage.getItem('maxmix.deviceId')
    }));
    expect(stored.deviceId).toBe('0a1b2c3d4e5f');
    expect(stored.secret).toMatch(/^[0-9a-f]{64}$/);

    expect(visits).toHaveLength(1);
    const [visit] = visits;
    expect(visit?.searchParams.get('secret_hash')).toMatch(/^[0-9a-f]{64}$/);
    expect(visit?.searchParams.get('secret_hash')).not.toBe(stored.secret);
    expect(visit?.href).not.toContain(stored.secret ?? '');
    expect(visit?.searchParams.get('width')).toMatch(/^\d+$/);
    expect(visit?.searchParams.get('height')).toMatch(/^\d+$/);
    expect(visit?.searchParams.get('return_to')).toBe('http://127.0.0.1:3100/?countdown=registered');

    // Registered: the next start opens the app without going back to the server.
    await page.goto('/?kiosk=1');
    await expect(page.getByRole('tabpanel', { name: 'Dashboard' })).toBeVisible();
    expect(visits).toHaveLength(1);
  });

  test('a screen someone else owns says so, and Try again goes back to the server', async ({ page }, testInfo) => {
    const visits = await fakeRegisterPage(page, { error: 'taken' });
    await page.goto('/?kiosk=1');

    const problem = page.getByRole('dialog', { name: 'Couldn’t add this screen' });
    await expect(problem.getByText('This screen belongs to someone else.')).toBeVisible();
    expect(new URL(page.url()).search).toBe('');
    await page.setViewportSize({ width: 1024, height: 600 });
    await testInfo.attach('registration-taken-1024x600', { body: await page.screenshot(), contentType: 'image/png' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await testInfo.attach('registration-taken-1280x800', { body: await page.screenshot(), contentType: 'image/png' });

    const secret = await page.evaluate(() => localStorage.getItem('maxmix.deviceSecret'));
    await problem.getByRole('button', { name: 'Try again' }).click();
    await expect(problem).toBeVisible();
    expect(visits).toHaveLength(2);
    expect(visits[1]?.searchParams.get('secret_hash')).toBe(visits[0]?.searchParams.get('secret_hash'));
    expect(await page.evaluate(() => localStorage.getItem('maxmix.deviceSecret'))).toBe(secret);

    await problem.getByRole('button', { name: 'Close' }).click();
    await expect(problem).toBeHidden();
    await expect(page.getByRole('tabpanel', { name: 'Dashboard' })).toBeVisible();
  });
});
